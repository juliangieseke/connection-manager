import { XHRConnection, AbstractConnection, ConnectionEvent } from "@dcos/connections";
import { default as ConnectionManager } from "./ConnectionManager";
import { setInterval, setTimeout } from "timers";

const cl = console.log;
// console.log = function() {};
const stats = {
    open:0,
    create:0,
    abort:0,
    error:0,
    complete:0
}

function updateHtml() {
    
    Object.keys(stats).forEach(function(key) {
        document.getElementById(key).innerHTML = stats[key];
    });
}
setInterval(updateHtml, 100);

function s(p, i) {
    const connection = new XHRConnection(`test.html?p=${p}&i=${i}&d=${Date.now()}`);
    stats.create++;
    connection.on(ConnectionEvent.OPEN, event => {
        stats.open++;
    });
    connection.on(ConnectionEvent.ABORT, event => {
        stats.open--;
        stats.abort++;
        console.log(`retry ${i}`);
        cm.schedule(s(p, i), p);
    });
    connection.on(ConnectionEvent.ERROR, event => {
        stats.open--;
        stats.error++;
    });
    connection.on(ConnectionEvent.COMPLETE, event => {
        stats.open--;
        stats.complete++;
    });
    return connection;
}

const cm = new ConnectionManager();

// // setTimeout(function() {
// console.log("add 1, gets started");
// cm.schedule(s(1, 1), 1);
// // },0);

// // setTimeout(function() {
// console.log("add 2, gets started");
// cm.schedule(s(2, 2), 2);
// // },200);

// // setTimeout(function() {
// console.log("add 3, kill 1");
// cm.schedule(s(3, 3), 3);
// // },0);

// // setTimeout(function() {
// console.log("add 4, kill 2");
// cm.schedule(s(4, 4), 4);
// // },0);

// // setTimeout(function() {
// console.log("add 2, queue");
// cm.schedule(s(2, 5), 2);
// // },0);

// // setTimeout(function() {
// console.log("add open 1, should be killed");
// const co = s(1, 6);
// co.open();
// cm.schedule(co, 1);
// // },400);

// // setTimeout(function() {
// console.log("add 1, should be queued");
// const cs = new XHRConnection(`test.html?p=1&i=7&d=${Date.now()}`);
// cs.on(ConnectionEvent.OPEN, event => console.log(event.target.url, "OPEN"));
// cs.on(ConnectionEvent.COMPLETE, event => console.log(event.target.url, "COMPLETE"));
// cm.schedule(cs, 1);
// // },600);

// // setTimeout(function() {
// // console.log = cl;
// console.log("add 10, should kill 1");
// let ci = new XHRConnection(`test.html?p=10&i=8&d=${Date.now()}`);
// ci.on(ConnectionEvent.OPEN, event => console.log(event.target.url, "OPEN"));
// ci.on(ConnectionEvent.COMPLETE, event => console.log(event.target.url, "COMPLETE"));
// ci.on(ConnectionEvent.ABORT, event => console.log(event.target.url, "ABORT"));
// ci.open();
// cm.schedule(ci, 10);
// // },800);

var i = 1;
var intval;

document.getElementById("stop").addEventListener("click", function() {
    window.clearInterval(intval);
});
document.getElementById("start").addEventListener("click", function() {
    intval = window.setInterval(function() {
        const p = Math.ceil(Math.random()*100);
        console.log(`scheduling (${i})`);
        cm.schedule(s(p, i++), p)
    }, 500);
});
document.getElementById("flood").addEventListener("click", function() {
    for(let r = 0; r<20; r++) {
        const p = Math.ceil(Math.random()*100);
        console.log(`scheduling (${i})`);
        cm.schedule(s(p, i++), p)
    }
});


// setTimeout(function() {
//     console.log("increasing priority to 10");
//     cm.schedule(cs, 10);
// }, 500);

// setTimeout(function() {
//     console.log("decrease priority to 1");
//     cm.schedule(ci, 1);
// }, 2000);

// setInterval(function() {
//     const p = Math.ceil(Math.random()*100);
//     const c = s(p, i++);
//     console.log(`scheduling OPEN random (${p})`);
//     c.open();
//     cm.schedule(c, p);
// }, 3000);
