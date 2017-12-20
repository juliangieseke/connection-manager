import { List } from "immutable";
import { AbstractConnection, ConnectionEvent } from "@dcos/connections";
import ConnectionQueueItem from "./ConnectionQueueItem";

/**
 * The Connection Manager which is responsible for
 * queuing Connections into the ConnectionQueue and
 * actually starting them, when they are head of
 * waiting line.
 */
export default class ConnectionManager {
  /**
   * Initializes an Instance of ConnectionManager
   *
   * @param {int} maxConnections – max open connections
   */
  constructor(maxConnections = 6, threshold = 0.7) {
    /**
     * Private Context
     *
     * @typedef {Object} ConnectionManager~Context
     */
    const context = {
      /**
       * @property {ConnectionManager} instance
       * @description Current connection manager instance
       * @name ConnectionManager~Context#instance
       */
      instance: this,

      /**
       * @property {ConnectionQueue} list
       * @description List of connections ordered by priority
       * @name ConnectionManager~Context#list
       */
      list: List(),

      /**
       * @property {function} next
       * @description Opens the the connection if there's a free slot.
       * @name ConnectionManager~Context#next
       */
      next() {

        // count open connections
        const openCount = context.list.count(listItem =>
          listItem.connection.state === AbstractConnection.OPEN);

        //if list.size === openCount, no waiting connection exist
        if (
          openCount >= maxConnections ||
          context.list.size === openCount
        ) {
          return;
        }

        //get first waiting connection and open it
        const item = context.list.find(listItem =>
          listItem.connection.state === AbstractConnection.INIT);
        
        if (!item) {
          return;
        }

        context.openConnection(item.connection);

        // next please
        context.next();
      },

      /**
       * @property {function} handleConnectionAbort
       * @name ConnectionManager~Context#handleConnectionAbort
       * @param {ConnectionEvent} event
       */
      handleConnectionAbort: event =>
        context.handleConnectionComplete(event),

      /**
       * @property {function} handleConnectionComplete
       * @name ConnectionManager~Context#handleConnectionComplete
       * @param {ConnectionEvent} event
       */
      handleConnectionComplete: event => {
        const item = new ConnectionQueueItem(event.target);

        // remove listeners from connection
        context.removeListeners(item.connection);

        // start next connection from queue (if any)
        context.next();
      },

      /**
       * @property {function} handleConnectionError
       * @name ConnectionManager~Context#handleConnectionError
       * @param {ConnectionEvent} event
       */
      handleConnectionError: event =>
        context.handleConnectionComplete(event),

      /**
       * Closes low prio connections until a slot is free
       *
       * @param {int} priority
       * @return {int} - number of free slots
       */
      requestFreeSlot(priority) {

        // get last (lowest priority) open connection in list
        const item = context.list.findLast(listItem =>
          listItem.connection.state === AbstractConnection.OPEN);
        
        
        // no open item.
        if (!item) {
          console.log("requestFreeSlot: item is undefined");
          return true;
        }

        console.log("requestFreeSlot:", context.list, item.connection.state, item, priority, priority * threshold, item.priority < priority * threshold);

        // not all slots occupied
        if(context.list.count(listItem => listItem.connection.state === AbstractConnection.OPEN) < maxConnections) {
          console.log("requestFreeSlot: not all slot occipued");
          return true;
        }

        // close least important open connection, if the given one is more important
        if (
          item.priority < priority * threshold
        ) {
          // remove connection from list
          context.list = context.list.filter(
            listItem => !listItem.equals(item)
          );
          item.connection.close();
          return true;
        }

        // return free open slots
        return false;
      },

      /**
       * Opens a Connection
       * 
       * @param {AbstractConnection} connection
       */
      openConnection(connection) {

        // add listeners for handling it - these will call context.next() when the connection is closed.
        context.addListeners(connection);

        // open connection with token (TBD)
        connection.open({ "Authentication": "Bearer TOKEN" });
      },

      /**
       * Adds Listeners to Connection
       * 
       * @param {AbstractConnection} connection 
       */
      addListeners(connection) {
        connection.addListener(ConnectionEvent.ABORT, context.handleConnectionAbort);

        connection.addListener(
          ConnectionEvent.COMPLETE,
          context.handleConnectionComplete
        );

        connection.addListener(ConnectionEvent.ERROR, context.handleConnectionError);
      },

      /**
       * Removes Listeners from Connection
       * 
       * @param {AbstractConnection} connection 
       */
      removeListeners(connection) {
        connection.removeListener(
          ConnectionEvent.ABORT,
          context.handleConnectionAbort
        );
        connection.removeListener(
          ConnectionEvent.COMPLETE,
          context.handleConnectionComplete
        );
        connection.removeListener(
          ConnectionEvent.ERROR,
          context.handleConnectionError
        );
      },

      /**
       * Updates the Priority of Index
       * 
       * @param {int} index 
       * @param {int} priority 
       */
      update(index, priority) {
        const item = context.list.get(index);

        // well…
        if (item.priority === priority) {
          return context.list;
        }

        // connection is open,
        // prio is decreased,
        // all slots are occupied
        // and there is a waiting connection with higher prio
        // => close this one.
        if (item.connection.state === AbstractConnection.OPEN &&
          priority < item.priority &&
          context.list.count(listItem => listItem.connection.state === AbstractConnection.OPEN) === maxConnections &&
          context.list.find(listItem => listItem.connection.state === AbstractConnection.INIT).priority * threshold > priority
        ) {
          setTimeout(() => item.connection.close(), 0);
          // remove connection from list
          return context.list.filter(
            listItem => !listItem.equals(item)
          );
        }

        // connection was still in queue
        // if priority increased, 
        // can we start it right now?
        if (item.connection.state === AbstractConnection.INIT &&
          priority > item.priority &&
          // @TODO get rid of requestFreeSlot here, 
          context.requestFreeSlot(item.priority)
        ) {
          context.openConnection(item.connection);
        }

        // update & sort list
        return context.list
          .update(index, listItem => new ConnectionQueueItem(item.connection, priority))
          .sortBy(listItem => -1 * listItem.priority);

      },

      /**
       * Pushes a new item into the list
       * 
       * @param {ConnectionQueueItem} item 
       * @return {List} - updated connection list
       */
      push(item) {

        // theoreticly it is possible to open connections on your own
        // and then add them to the manager, if this happened and 
        // there is no free slot, we have to kill them now…
        if (item.connection.state === AbstractConnection.OPEN && !context.requestFreeSlot(item.priority)) {
          setTimeout(() => item.connection.close(), 0);
          return context.list;
        }

        // if a slot is available ant not yet opened, open :)
        if (item.connection.state === AbstractConnection.INIT && context.requestFreeSlot(item.priority)) {
          context.openConnection(item.connection);
        }

        // connection accepted, store it in list \o/
        return context.list
          .push(item)
          .sortBy(listItem => -1 * listItem.priority);
      }
    };

    this.schedule = this.schedule.bind(context);
  }

  /**
   * Queues given connection with given priority
   *
   * @this ConnectionManager~Context
   * @param {AbstractConnection} connection – connection to queue
   * @param {Integer} [priority] – optional change of priority
   * @return {bool} - true if the connection was added, false if not.
   */
  schedule(connection, priority) {

    // maybe we got a closed connection, nothing to do.
    if (connection.state === AbstractConnection.CLOSED) {
      return;
    }

    // create a new QueueItem to have the correct default priority
    const item = new ConnectionQueueItem(connection, priority);

    // if the connection is already queued, we need to update it
    const index = this.list.findIndex(listItem => listItem.equals(item));


    if (index >= 0) {
      this.list = this.update(index, priority);
    } else {
      this.list = this.push(item);
    }

    return;
  }
}
