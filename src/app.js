import { XHRConnection, AbstractConnection, ConnectionEvent } from "@dcos/connections";
import { default as ConnectionManager } from "./ConnectionManager";
import { setInterval, setTimeout } from "timers";
import { List } from "immutable";


const connectionManager = new ConnectionManager(5);
let connectionsList = List();
let randtimer;
let runnerCreated = 0;
let runnerCompleted = 0;

function updateHtml() {
    
    const list = connectionManager.list();
    const openList = list.filter(listItem => listItem.connection.state === AbstractConnection.OPEN);
    const waitingList = list.filter(listItem => listItem.connection.state === AbstractConnection.INIT);

    document.getElementById("cmlist").innerHTML = list.size;
    document.getElementById("cmopen").innerHTML = openList.size;
    document.getElementById("cmwaiting").innerHTML = waitingList.size;

    if(connectionsList.size) {
        document.getElementById("alive").innerHTML = connectionsList.size;
    } else {
        document.getElementById("alive").innerHTML = 0;
    }

    document.getElementById("created").innerHTML = runnerCreated;
    document.getElementById("completed").innerHTML = runnerCompleted;

    if(openList.size) {
        document.getElementById("cmlowopen").innerHTML = openList.last().priority;
        document.getElementById("openlist").innerHTML = openList.reduce((prev, cur, index) => {
            return prev.concat(cur.connection.url);
        }, []).join("<br>");
        document.getElementById("lastopen").innerHTML = openList.last().connection.url;
    } else {
        document.getElementById("cmlowopen").innerHTML = "0";
        document.getElementById("openlist").innerHTML = "no open connections";
        document.getElementById("lastopen").innerHTML = "no open connections";
    }

    if(waitingList.size) {
        document.getElementById("cmhighwait").innerHTML = waitingList.first().priority;
        document.getElementById("waitinglist").innerHTML = waitingList.slice(0, 10).reduce((prev, cur, index) => {
            return prev.concat(cur.connection.url);
        }, []).join("<br>");
        document.getElementById("firstwaiting").innerHTML = waitingList.first().connection.url;
    } else {
        document.getElementById("cmhighwait").innerHTML = "0";
        document.getElementById("waitinglist").innerHTML = "no waiting connections";
        document.getElementById("firstwaiting").innerHTML = "no waiting connections";
    }
}

function createConnection(slug, priority) {
    const details = `${slug}-${priority}`;
    const connection = new XHRConnection(`test.html?c=${details}`);
    
    connection.on(ConnectionEvent.ABORT, event => {
        connectionsList = connectionsList.filter(listConnection => listConnection !== event.target);
        setTimeout(() => connectionManager.schedule(createConnection(slug, priority), priority), 1000);
    });
    connection.on(ConnectionEvent.ERROR, event => {
        connectionsList = connectionsList.filter(listConnection => listConnection !== event.target);
    });
    connection.on(ConnectionEvent.COMPLETE, event => {
        connectionsList = connectionsList.filter(listConnection => listConnection !== event.target);
        runnerCompleted += 1;
    });
    connectionsList = connectionsList.push(connection);
    return connection;
}




setInterval(updateHtml, 100);




document.getElementById("randomstop").addEventListener("click", function() {
    window.clearTimeout(randtimer);
    randtimer = false;
});
document.getElementById("randomstart").addEventListener("click", function() {
    function nexttimer() {
        const priority = Math.ceil(Math.random()*100);
        connectionManager.schedule(createConnection(runnerCreated++, priority), priority);
        randtimer = window.setTimeout(nexttimer, document.getElementById("randomint").value)
    }
    if (randtimer) return;
    nexttimer();
});
document.getElementById("initadd").addEventListener("click", function() {
    const priority = parseInt(document.getElementById("initprio").value);
    connectionManager.schedule(createConnection(runnerCreated++, priority), priority);
});

document.getElementById("openadd").addEventListener("click", function() {
    const priority = parseInt(document.getElementById("openprio").value);
    const connection = createConnection(runnerCreated++, priority);
    connection.open();
    connectionManager.schedule(connection, priority);
});

document.getElementById("openres").addEventListener("click", function() {
    const connection = connectionManager.list().filter(listItem => listItem.connection.state === AbstractConnection.OPEN).last().connection;
    if(connection.state !== AbstractConnection.CLOSED) {
        connectionManager.schedule(connection, parseInt(document.getElementById("openresprio").value));
    }
});

document.getElementById("waitingres").addEventListener("click", function() {
    const connection = connectionManager.list().filter(listItem => listItem.connection.state === AbstractConnection.INIT).first().connection;
    if(connection.state !== AbstractConnection.CLOSED) {
        connectionManager.schedule(connection, parseInt(document.getElementById("waitingresprio").value));
    }
});
