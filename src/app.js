import { XHRConnection, AbstractConnection, ConnectionEvent } from "@dcos/connections";
import { default as ConnectionManager } from "./ConnectionManager";
import { setInterval, setTimeout } from "timers";
import { List } from "immutable";

const connectionManager = new ConnectionManager();
const connectionArray = [];
const stats = {
    open:0,
    create:0,
    abort:0,
    error:0,
    complete:0
}

let connectionsIdAutoIncrement = 0;
let intval;

function updateHtml() {
    
    Object.keys(stats).forEach(function(key) {
        document.getElementById(key).innerHTML = stats[key];
    });
    document.getElementById("cmopen").innerHTML = connectionManager.open();
    document.getElementById("cmwaiting").innerHTML = connectionManager.waiting();
    document.getElementById("cmlowopen").innerHTML = connectionManager.lowestOpenPriority();
    document.getElementById("cmhighwait").innerHTML = connectionManager.highestWaitingPriority();

    if(connectionArray[connectionsIdAutoIncrement-1]) {
        document.getElementById("lasturl").innerHTML = connectionArray[connectionsIdAutoIncrement-1].url;
        document.getElementById("laststate").innerHTML = connectionArray[connectionsIdAutoIncrement-1].state.toString();
    }
}
setInterval(updateHtml, 100);

function createConnection(priority, index, retry = 0) {
    const connection = new XHRConnection(`test.html?c=${Date.now()}-prio:${priority}-index:${index}`);
    stats.create++;
    connection.on(ConnectionEvent.OPEN, event => {
        stats.open++;
    });
    connection.on(ConnectionEvent.ABORT, event => {
        stats.open--;
        stats.abort++;
        if(retry) connectionManager.schedule(createConnection(priority, index, retry--), priority);
    });
    connection.on(ConnectionEvent.ERROR, event => {
        stats.open--;
        stats.error++;
    });
    connection.on(ConnectionEvent.COMPLETE, event => {
        stats.open--;
        stats.complete++;
    });
    connectionArray[index] = connection;
    return connection;
}



document.getElementById("randomstop").addEventListener("click", function() {
    window.clearInterval(intval);
});
document.getElementById("randomstart").addEventListener("click", function() {
    if (intval) return;
    intval = window.setInterval(function() {
        const priority = Math.ceil(Math.random()*100);
        connectionManager.schedule(createConnection(priority, connectionsIdAutoIncrement++, 3), priority);
    }, document.getElementById("randomint").value);
});
document.getElementById("flood").addEventListener("click", function() {
    const cnt = document.getElementById("floodcount").value;
    for(let r = 0; r<cnt; r++) {
        const priority = Math.ceil(Math.random()*100);
        connectionManager.schedule(createConnection(priority, connectionsIdAutoIncrement++, 3), priority);
    }
});

document.getElementById("openadd").addEventListener("click", function() {
    const priority = parseInt(document.getElementById("openprio").value);
    const connection = createConnection(priority, connectionsIdAutoIncrement++, 3);
    connection.open();
    connectionManager.schedule(connection, priority);
});

document.getElementById("res").addEventListener("click", function() {
    const priority = parseInt(document.getElementById("resprio").value);
    const connection = connectionArray[connectionsIdAutoIncrement-1];
    if(connection.state === AbstractConnection.CLOSED) { alert(`${connectionsIdAutoIncrement-1} is already closed`); return; }
    connectionManager.schedule(connection, priority);
});
