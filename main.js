import { AjaxHelper, SchedulerPro } from '@bryntum/schedulerpro';

const logElement = document.getElementById('log');
const log = message => {
    logElement.textContent += `${new Date().toLocaleTimeString()}  ${message}\n`;
    console.log(message);
};

const RESOURCE_COUNT = 200;
const CHUNK_SIZE = 50;

const resources = Array.from({ length : RESOURCE_COUNT }, (_, i) => ({ id : i + 1, name : `Employee ${i + 1}` }));
const events = resources.map(({ id }) => ({
    id         : id,
    resourceId : id,
    name       : `Shift ${id}`,
    startDate  : '2026-01-05T08:00',
    endDate    : '2026-01-05T16:00'
}));

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
        delay : 300
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
const removeEventDuring = (eventName, id) => {
    project.on({
        [eventName]() {
            queueMicrotask(() => {
                const record = project.eventStore.getById(id);
                project.eventStore.remove(record);
                log(`removed event ${id} — change tracking suspended at that moment: ${project.isChangeTrackingSuspended}`);
            });
        },
        once : true
    });
};

const report = async label => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const pending = project.crudStoreHasChanges();
    log(`${label}: pending changes = ${pending}, sync requests so far = ${syncRequests.length}`);
    log(pending ? `BUG — the removal is staged but no sync was ever scheduled for it` : 'OK — the removal was sent');
    return { pending, syncRequests : syncRequests.length };
};

// Scrolling to the bottom makes the lazy-loading resource store request the next page.
const removeDuringLoad = async () => {
    removeEventDuring('beforeLoadCrudManagerData', 1);
    scheduler.scrollable.y = scheduler.scrollable.maxY;
    return report('during a lazy-loaded page');
};

// A first removal triggers a sync; a second one is made while that sync's response is applied.
const removeDuringSync = async () => {
    const before = syncRequests.length;
    removeEventDuring('beforeSyncCrudManagerData', 3);
    project.eventStore.remove(project.eventStore.getById(2));
    log('removed event 2 — triggers a sync');
    const result = await report('during a sync response');
    log(`syncs sent after the first removal: ${syncRequests.length - before} (2 expected: one per removal)`);
    return result;
};

document.getElementById('during-load').addEventListener('click', removeDuringLoad);
document.getElementById('during-sync').addEventListener('click', removeDuringSync);

project.on({ load : ({ response }) => log(`page loaded — ${response.resources.rows.length} resources`) });

window.scheduler = scheduler;
window.removeDuringLoad = removeDuringLoad;
window.removeDuringSync = removeDuringSync;
