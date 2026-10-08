import { AjaxHelper, SchedulerPro } from '@bryntum/schedulerpro';

const logElement = document.getElementById('log');
const log = message => {
    logElement.textContent += `${new Date().toLocaleTimeString()}  ${message}\n`;
    console.log(message);
};

const RESOURCE_COUNT = 200;
const CHUNK_SIZE = 50;

// Applying a page takes longer the more events it carries; `?events=` sets how many each resource gets beyond its first.
const EXTRA_EVENTS_PER_RESOURCE = Number(new URLSearchParams(location.search).get('events') ?? 0);

const resources = Array.from({ length : RESOURCE_COUNT }, (_, i) => ({ id : i + 1, name : `Employee ${i + 1}` }));
const events = resources.flatMap(({ id }) => [
    { id, resourceId : id, name : `Shift ${id}`, startDate : '2026-01-05T08:00', endDate : '2026-01-05T16:00' },
    ...Array.from({ length : EXTRA_EVENTS_PER_RESOURCE }, (_, k) => ({
        id         : `${id}-${k}`,
        resourceId : id,
        name       : `Extra ${id}.${k}`,
        startDate  : new Date(2026, 0, 6 + (k % 5), 8),
        endDate    : new Date(2026, 0, 6 + (k % 5), 9)
    }))
]);

// A plain paged backend: every load answers one window of rows, every sync just acknowledges.
const syncRequests = [];
// The CrudManager sends its request packet as JSON, in the `data` query parameter for a load and the body for a sync.
const requestPacket = options => JSON.parse(options.body ?? options.queryParams.data);

AjaxHelper.mockUrl('load', (url, params, options) => {
    const { startIndex, count } = requestPacket(options).params;
    const page = resources.slice(startIndex, startIndex + count);
    const pageIds = new Set(page.map(({ id }) => id));
    return {
        responseText : JSON.stringify({
            success   : true,
            resources : { rows : page, total : RESOURCE_COUNT },
            events    : { rows : events.filter(({ resourceId }) => pageIds.has(resourceId)) }
        }),
        delay : 0
    };
});
AjaxHelper.mockUrl('sync', (url, params, options) => {
    const packet = requestPacket(options);
    syncRequests.push(packet);
    log(`sync request sent: events ${JSON.stringify(packet.events)}`);
    return { responseText : JSON.stringify({ success : true }), delay : 300 };
});

const scheduler = new SchedulerPro({
    appendTo   : 'container',
    startDate  : new Date(2026, 0, 5),
    endDate    : new Date(2026, 0, 12),
    viewPreset : 'weekAndDayLetter',
    // Keeps rows one bar high however many events they carry, so the screen stays usable with `?events=`
    eventLayout : 'none',
    columns    : [{ text : 'Employee', field : 'name', width : 160 }],
    project    : {
        autoSync  : true,
        lazyLoad  : { chunkSize : CHUNK_SIZE },
        loadUrl   : 'load',
        syncUrl   : 'sync',
        autoLoad  : true
    }
});

const { project } = scheduler;

// The edit stands in for a user's click. It is queued from an event Bryntum fires just before it suspends change
// tracking to apply a response, so it runs while that response is still being applied — the window a real click can
// land in, since applying waits on the engine commit.
let removingFromScript = false;
const removeFromScript = id => {
    removingFromScript = true;
    project.eventStore.remove(project.eventStore.getById(id));
    removingFromScript = false;
};

const removeEventDuring = (eventName, id) => {
    project.on({
        [eventName]() {
            queueMicrotask(() => {
                removeFromScript(id);
                log(`removed event ${id} — change tracking suspended at that moment: ${project.isChangeTrackingSuspended}`);
            });
        },
        once : true
    });
};

const report = async (label, id) => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const pending = project.crudStoreHasChanges();
    const sent = syncRequests.some(({ events }) => [...(events?.removed ?? []), ...(events?.updated ?? [])].some(row => row.id === id));
    log(`${label}: pending changes = ${pending}, sync requests so far = ${syncRequests.length}`);
    if (sent) {
        log(`OK — the change to event ${id} was sent`);
    }
    else {
        log(pending
            ? `BUG — the change to event ${id} is staged but no sync was ever scheduled for it`
            : `BUG — the change to event ${id} was never sent, and is no longer even pending`);
    }
    return { sent };
};

// Scrolling to the bottom makes the lazy-loading resource store request the next page.
const removeDuringLoad = async () => {
    removeEventDuring('beforeLoadCrudManagerData', 1);
    scheduler.scrollable.y = scheduler.scrollable.maxY;
    return report('during a lazy-loaded page', 1);
};

// A first removal triggers a sync; a second one is made while that sync's response is applied.
const removeDuringSync = async () => {
    const before = syncRequests.length;
    removeEventDuring('beforeSyncCrudManagerData', 3);
    removeFromScript(2);
    log('removed event 2 — triggers a sync');
    const result = await report('during a sync response', 3);
    log(`syncs sent after the first removal: ${syncRequests.length - before} (2 expected: one per removal)`);
    return result;
};

// Manual mode: click a bar, press L, then Delete right away. L asks for the next page of rows without moving the view,
// standing in for scrolling down — scrolling would take the selected bar off screen. Delete is Bryntum's own key.
let nextPageIndex = CHUNK_SIZE;
document.addEventListener('keydown', ({ key }) => {
    if ((key === 'l' || key === 'L') && nextPageIndex < RESOURCE_COUNT) {
        log(`L — requesting rows ${nextPageIndex}-${nextPageIndex + CHUNK_SIZE - 1}`);
        project.resourceStore.lazyGetAt(nextPageIndex);
        nextPageIndex += CHUNK_SIZE;
    }
});
project.eventStore.on({
    remove({ records, isMove }) {
        if (isMove || removingFromScript) {
            return;
        }
        for (const record of records) {
            log(`Delete — removed event ${record.id}, change tracking suspended at that moment: ${project.isChangeTrackingSuspended}`);
            report('manual delete', record.id);
        }
    }
});

scheduler.on({
    eventDrop({ eventRecords }) {
        for (const record of eventRecords) {
            log(`drop — moved event ${record.id}, change tracking suspended at that moment: ${project.isChangeTrackingSuspended}`);
            report('manual drop', record.id);
        }
    }
});

document.getElementById('during-load').addEventListener('click', removeDuringLoad);
document.getElementById('during-sync').addEventListener('click', removeDuringSync);

project.on({ load : ({ response }) => log(`page loaded — ${response.resources.rows.length} resources`) });

window.scheduler = scheduler;
window.removeDuringLoad = removeDuringLoad;
window.removeDuringSync = removeDuringSync;
