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

        // remove listeners from connection to 
        // prevent any kind of weird loops
        context.removeListeners(item.connection);

        // dequeue connection from list
        context.list.filter(
          listItem => !listItem.equals(item)
        );

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
       * @return {bool} - true if there is a free slot, false if not.
       */
      requestFreeSlot(priority) {

        // helper function to get open count
        // @TODO check if we want this globally
        function openCount() {
          return context.list.count(listItem =>
            listItem.connection.state === AbstractConnection.OPEN);
        }

        // helper function to get last Item
        // @TODO check if we want this globally
        function findLast() {
          return context.list.findLast(listItem =>
            listItem.connection.state === AbstractConnection.OPEN)
        }

        // get last (lowest priority) open connection in list
        let item = findLast();

        // while last connections priority is low enough, close it
        // @TODO this might be a bit slow
        while (
          item &&
          openCount() < maxConnections &&
          item.priority < priority * threshold
        ) {
          item.connection.close();
          item = findLast();
        }
        return openCount() < maxConnections;
      },

      /**
       * Opens a Connection
       * 
       * @param {AbstractConnection} connection
       */
      openConnection(connection) {

        // add listeners for handling it - these will call this.next() when the connection is closed.
        this.addListeners(connection);

        // open connection with token (TBD)
        connection.open({ "Authentication": "Bearer TOKEN" });
      },

      /**
       * Adds Listeners to Connection
       * 
       * @param {AbstractConnection} connection 
       */
      addListeners(connection) {
        connection.addListener(ConnectionEvent.ABORT, this.handleConnectionAbort);

        connection.addListener(
          ConnectionEvent.COMPLETE,
          this.handleConnectionComplete
        );

        connection.addListener(ConnectionEvent.ERROR, this.handleConnectionError);
      },

      /**
       * Removes Listeners from Connection
       * 
       * @param {AbstractConnection} connection 
       */
      removeListeners(connection) {
        connection.removeListener(
          ConnectionEvent.ABORT,
          this.handleConnectionAbort
        );
        connection.removeListener(
          ConnectionEvent.COMPLETE,
          this.handleConnectionComplete
        );
        connection.removeListener(
          ConnectionEvent.ERROR,
          this.handleConnectionError
        );
      }
    };

    this.enqueue = this.enqueue.bind(context);
    this.dequeue = this.dequeue.bind(context);
  }

  /**
   * Queues given connection with given priority
   *
   * @this ConnectionManager~Context
   * @param {AbstractConnection} connection – connection to queue
   * @param {Integer} [priority] – optional change of priority
   * @return {bool} - true if the connection was added, false if not.
   */
  enqueue(connection, priority) {

    // maybe we got a closed connection, nothing to do.
    if (connection.state === AbstractConnection.CLOSED) {
      return false;
    }

    // create a new QueueItem to have the correct default priority
    const item = new ConnectionQueueItem(connection, priority);

    // connection already queued, update is not allowed at this point
    // @TODO make it work
    if (this.list.some(listItem => listItem.equals(item))) {
      return false;
    }

    // lets see if we can get a free slot, this could close 
    // low priority connections in favor of this.
    if (this.requestFreeSlot(item.priority)) {

      // if not yet opened, open :)
      if (item.connection.state === AbstractConnection.INIT) {
        this.openConnection(item.connection);
      }

    } else {

      // theoreticly it is possible to open connections on your own
      // and then add them to the manager, if this happened we have
      // to kill them now…
      if (item.connection.state === AbstractConnection.OPEN) {
        item.connection.close();
        return false;
      }
    }

    // connection accepted, store it in list \o/
    this.list = this.list
      .push(item)
      .sortBy(listItem => -1 * listItem.priority);

    // connection was enqueued (or directly started).
    return true;
  }

  /**
   * Dequeues given connection
   *
   * @this ConnectionManager~Context
   * @param {AbstractConnection} connection – connection to dequeue
   */
  dequeue(connection) {

    // if a connection is closed, it is already dequeued
    if (connection.state === AbstractConnection.CLOSED) {
      return false;
    }

    // create item for easier handling
    const item = new ConnectionQueueItem(connection);

    // if connection is open, close it — this will call next() and remove listeners!
    if (connection.state === AbstractConnection.OPEN) {
      connection.close();
    }

    // remove it from list
    this.list = this.list.filter(
      listItem => !listItem.equals(item)
    );
  }
}
