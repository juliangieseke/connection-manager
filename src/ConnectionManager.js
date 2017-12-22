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
        setTimeout(() => context.list = context.process(context.list), 0);
      },

      /**
       * @property {function} handleConnectionError
       * @name ConnectionManager~Context#handleConnectionError
       * @param {ConnectionEvent} event
       */
      handleConnectionError: event =>
        context.handleConnectionComplete(event),

      /**
       * Opens a Connection
       * 
       * @param {AbstractConnection} connection
       */
      openConnection(connection) {

        // open connection with token (TBD)
        connection.open({ "Authentication": "Bearer TOKEN" });
      },

      /**
       * Adds Listeners to Connection
       * 
       * @param {AbstractConnection} connection 
       */
      addListeners(connection) {
        connection.addListener(
          ConnectionEvent.ABORT,
          context.handleConnectionAbort
        );
        connection.addListener(
          ConnectionEvent.COMPLETE,
          context.handleConnectionComplete
        );
        connection.addListener(
          ConnectionEvent.ERROR,
          context.handleConnectionError
        );
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

      process(list) {
        //now the first {maxConnection} items should be open
        let openList = list.filter(listItem => listItem.connection.state === AbstractConnection.OPEN);
        let waitingList = list.filter(listItem => listItem.connection.state === AbstractConnection.INIT);
        
        // first, close connections if needed
        while(openList.size > maxConnections) {
          const openItem = openList.last();
          openList = openList.pop();

          openItem.connection.close();
        }

        //second, open more connections if possible
        while(waitingList.size && openList.size < maxConnections) {
          const waitingItem = waitingList.first();
          waitingList = waitingList.shift();
          context.addListeners(waitingItem.connection);

          context.openConnection(waitingItem.connection);
          openList = openList.push(waitingItem);
        }

        //quickly sort openList
        openList = openList.sortBy(listItem => -1 * listItem.priority);

        //third, close low priority connections in favor of higher prio ones
        while(
          waitingList.size && openList.size &&
          waitingList.first().priority * threshold > openList.last().priority
        ) {
          const openItem = openList.last();
          const waitingItem = waitingList.first();

          // close open one
          openList = openList.pop();
          openItem.connection.close();

          // open waiting
          waitingList = waitingList.shift();
          context.addListeners(waitingItem.connection);
          context.openConnection(waitingItem.connection);
          openList = openList.push(waitingItem);
        }

        //sort again
        openList = openList.sortBy(listItem => -1 * listItem.priority);

        //and merge them again.
        return openList.concat(waitingList);
      },

      push(list, item) {

        if(item.connection.state === AbstractConnection.OPEN) {
          //add listeners
          this.addListeners(item.connection);
        }
        
        return context.process(
          list
            .filter(listItem => !listItem.equals(item))
            .push(item)
            .sortBy(listItem => -1 * listItem.priority)
        );
      }
    };

    this.schedule = this.schedule.bind(context);

    this.open = this.open.bind(context);
    this.waiting = this.waiting.bind(context);
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
    
    setTimeout(() => this.list = this.push(this.list, item), 0);
    
    return;
  }

  
  
  open() {
    return this.list.filter(listItem => listItem.connection.state === AbstractConnection.OPEN);
  }
  waiting() {
    return this.list.filter(listItem => listItem.connection.state === AbstractConnection.INIT);
  }

}
