import { XHRConnection, AbstractConnection, ConnectionEvent } from "@dcos/connections";
import { default as ConnectionManager } from "./ConnectionManager";
import { setInterval, setTimeout } from "timers";
import { List } from "immutable";


const connectionManager = new ConnectionManager(5);
let connectionsList = List();
let randtimer;
let runner = 0;

function updateHtml() {
    
    const openList = connectionManager.open();
    const waitingList = connectionManager.waiting();

    document.getElementById("cmopen").innerHTML = openList.size;
    document.getElementById("cmwaiting").innerHTML = waitingList.size;

    if(connectionsList.size) {
        document.getElementById("alive").innerHTML = connectionsList.size;
    } else {
        document.getElementById("alive").innerHTML = 0;
    }

    document.getElementById("created").innerHTML = runner;

    if(openList.size) {
        document.getElementById("cmlowopen").innerHTML = openList.last().priority;
        document.getElementById("openlist").innerHTML = openList.reduce((prev, cur, index) => {
            return prev.concat(cur.connection.url);
        }, []).join("<br>");
    } else {
        document.getElementById("cmlowopen").innerHTML = "0";
        document.getElementById("openlist").innerHTML = "no open connections";
    }

    if(waitingList.size) {
        document.getElementById("cmhighwait").innerHTML = waitingList.first().priority;
        document.getElementById("waitinglist").innerHTML = waitingList.slice(0, 10).reduce((prev, cur, index) => {
            return prev.concat(cur.connection.url);
        }, []).join("<br>");
    } else {
        document.getElementById("cmhighwait").innerHTML = "0";
        document.getElementById("waitinglist").innerHTML = "no waiting connections";
    }
}

function createConnection(slug, priority) {
    const details = `${slug}-${priority}`;
    const connection = new XHRConnection(`test.html?c=${details}`);
    
    connection.on(ConnectionEvent.ABORT, event => {
        connectionsList = connectionsList.filter(listConnection => {
            if(listConnection == event.target) {
                console.log(listConnection, event.target, listConnection !== event.target);
            }
            return listConnection !== event.target
        });
        setTimeout(() => connectionManager.schedule(createConnection(slug, priority), priority), 1000);
    });
    connection.on(ConnectionEvent.ERROR, event => {
        connectionsList = connectionsList.filter(listConnection => listConnection !== event.target);
    });
    connection.on(ConnectionEvent.COMPLETE, event => {
        connectionsList = connectionsList.filter(listConnection => listConnection !== event.target);
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
        connectionManager.schedule(createConnection(runner++, priority), priority);
        randtimer = window.setTimeout(nexttimer, document.getElementById("randomint").value)
    }
    if (randtimer) return;
    nexttimer();
});
document.getElementById("initadd").addEventListener("click", function() {
    connectionManager.schedule(createConnection(runner++, priority), parseInt(document.getElementById("initprio").value));
});

document.getElementById("openadd").addEventListener("click", function() {
    connectionManager.schedule(createConnection(runner++, priority).open(), parseInt(document.getElementById("openprio").value));
});

document.getElementById("res").addEventListener("click", function() {
    const connection = connectionsList.filter(listConnection => listConnection.state === AbstractConnection.OPEN).last();
    if(connection.state !== AbstractConnection.CLOSED) {
        connectionManager.schedule(connection, parseInt(document.getElementById("resprio").value));
    }
});
