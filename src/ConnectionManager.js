import { AbstractConnection, ConnectionEvent } from "@dcos/connections";
import ConnectionQueue from "./ConnectionQueue";
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
       * @property {ConnectionQueue} waitingList
       * @description List of waiting connections ordered by priority
       * @name ConnectionManager~Context#waitingList
       */
      waitingList: new ConnectionQueue(),

      /**
       * @property {List} openList
       * @description List of open connections
       * @name ConnectionManager~Context#next
       */
      openList: new ConnectionQueue(),

      /**
       * @property {function} next
       * @description Opens the the connection if there's a free slot.
       * @name ConnectionManager~Context#next
       */
      next() {
        if (
          context.openList.size >= maxConnections ||
          context.waitingList.size === 0
        ) {
          return;
        }

        const item = context.waitingList.first();

        if (item.connection.state === AbstractConnection.INIT) {
          context.openConnection(item.connection);
        }

        if (item.connection.state === AbstractConnection.OPEN) {
          context.openList = context.openList.enqueue(item);
        }

        context.waitingList = context.waitingList.shift(item);

        context.next();
      },

      /**
       * @property {function} handleConnectionAbort
       * @name ConnectionManager~Context#handleConnectionAbort
       * @param {ConnectionEvent} event
       */
      handleConnectionAbort: event => {
        context.handleConnectionComplete(event);
      },

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
        context.openList.dequeue(item.connection);

        // start next connection from queue (if any)
        context.next();
      },

      /**
       * @property {function} handleConnectionError
       * @name ConnectionManager~Context#handleConnectionError
       * @param {ConnectionEvent} event
       */
      handleConnectionError: event => {
        context.handleConnectionComplete(event);
      },

      /**
       * Closes low prio connections until a slot is free
       *
       * @param {int} priority
       * @return {bool} - true if there is a free slot, false if not.
       */
      requestFreeSlot(priority) {
        let item = this.openList.last();
        while (
          item &&
          this.openList.size >= maxConnections - 1 &&
          item.priority < priority * threshold
        ) {
          this.instance.dequeue(item.connection);
          item = this.openList.last();
        }
        return this.openList.size <= maxConnections - 1;
      },

      /**
       * Opens a Connection
       * 
       * @param {AbstractConnection} connection
       */
      openConnection(connection) {
        connection.open({"Authentication": "Bearer TOKEN"});
      },

      addListeners(connection) {
        connection.addListener(ConnectionEvent.ABORT, this.handleConnectionAbort);

        connection.addListener(
          ConnectionEvent.COMPLETE,
          this.handleConnectionComplete
        );

        connection.addListener(ConnectionEvent.ERROR, this.handleConnectionError);
      },
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

    // create a new QueueItem to have the correct default priority.
    const item = new ConnectionQueueItem(connection, priority);
  
    // lets see if we can kill other low priority connections 
    // in favor of this one.
    if (this.requestFreeSlot(item.priority)) {
      if (item.connection.state === AbstractConnection.INIT) {
        this.openConnection(item.connection);
      }
    } else {
      // theoreticly it is possible to open connections on your own
      // and then add them to the manager, if this happens and there 
      //is no free slot, we have to kill it.
      if (item.connection.state === AbstractConnection.OPEN) {
        item.connection.close();
        return false;
      }
    }

    // add listeners for handling it - these will call this.next() when the connection is closed.
    this.addListeners(item.connection);

    // ^^ no free slot, connection is still initialized, enqueue it in waiting list
    if (connection.state === AbstractConnection.INIT) {
      this.waitingList = this.waitingList.enqueue(item);
    }

    // ^^^ there was a free slot => connection is open, put in openList
    if(connection.state === AbstractConnection.OPEN) {
      this.openList = this.openList.enqueue(item);
    }
    
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
    // connection is already closed, nothing to do here
    if (connection.state === AbstractConnection.CLOSED) {
      return false;
    }

    const item = new ConnectionQueueItem(connection);

    // waiting connection? nothing more to 
    // do then remove it from the list
    if (connection.state === AbstractConnection.INIT) {
      this.waitingList = this.waitingList.dequeue(item);
      this.removeListener(item.connection);
    }

    // open connection? just close it, 
    // everything else is handled by handleClose 
    if (connection.state === AbstractConnection.OPEN) {
      connection.close();
    }
  }
}
