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
       * @param {int} newItem
       * @return {int} - number of free slots
       * @TODO needs a better name…
       * @TODO maybe we can either get rid of it in oush or use it in update?
       */
      requestFreeSlot(newItem) {

        // get last (lowest priority) open connection in list
        const item = context.list.findLast(listItem =>
          listItem.connection.state === AbstractConnection.OPEN);
        
        // no open item.
        if (!item) {
          return true;
        }

        // not all slots occupied
        if(context.list.count(listItem => listItem.connection.state === AbstractConnection.OPEN) < maxConnections) {
          return true;
        }

        // close least important open connection, 
        // if the given one is more important
        if (
          item.priority < newItem.priority * threshold
        ) {
          // remove connection from list
          context.list = context.list.filter(
            listItem => !listItem.equals(item)
          );
          setTimeout(() => item.connection.close(), 0);
          return true;
        }

        // no free slot available
        return false;
      },

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

      /**
       * Updates the Priority of Index
       * 
       * @param {int} index - index of existing (open or init) connection
       * @param {int} priority - new priority
       */
      update(index, priority) {
        const item = context.list.get(index);

        // well…
        if (item.priority === priority) {
          return;
        }

        // if connection is open,
        if(item.connection.state === AbstractConnection.OPEN) {
          // if prio is decreased,
          if (priority < item.priority &&
            // all slots are occupied
            context.list.count(listItem => listItem.connection.state === AbstractConnection.OPEN) === maxConnections &&
            // and there is a waiting connection with higher prio
            context.list.find(listItem => listItem.connection.state === AbstractConnection.INIT).priority * threshold > priority
          ) {
            // close async
            setTimeout(() => item.connection.close(), 0);
            // remove connection from list
            context.list = context.list.filter(
              listItem => !listItem.equals(item)
            );
            return;
          } else {
            // update & sort list
            // => see return statement below
          }
        }

        // connection was still in queue
        if(item.connection.state === AbstractConnection.INIT) {
          // if priority increased, 
          if (priority > item.priority &&
            // and there is a free slot
            context.requestFreeSlot(item)
          ) {
            // open this one
            context.openConnection(item.connection);
            // update & sort list
            // => see return statement below
          } else {
            // update & sort list
            // => see return statement below
          }
        }

        // update & sort list
        context.list = context.list
          .update(index, listItem => new ConnectionQueueItem(item.connection, priority))
          .sortBy(listItem => -1 * listItem.priority);
      },

      /**
       * Pushes a new item into the list
       * 
       * @param {ConnectionQueueItem} item - new open or init connection
       */
      push(item) {

        // it is possible to open connections on your own
        // and then add them to the manager, if this happened and 
        // there is no free slot, we have to kill them now…
        if (item.connection.state === AbstractConnection.OPEN && 
          !context.requestFreeSlot(item)
        ) {
          // we need to close the connection async.
          setTimeout(() => item.connection.close(), 0);
          // return untouched list
          return;
        } else {
          // connection.state is INIT or free slot available
          // we can add listeners and store the connection
        }
        
        // add listeners for handling it - these will 
        // call context.next() when the connection is closed.
        context.addListeners(item.connection);

        // if connection is not opened yet
        if (item.connection.state === AbstractConnection.INIT && 
          // and a free slot is available
          context.requestFreeSlot(item)
        ) {
          // open it
          context.openConnection(item.connection);
        } else {
          // connection was open (see above) or no free slot available
        }

        // store it in list
        context.list = context.list
          .push(item)
          .sortBy(listItem => -1 * listItem.priority);
      }
    };

    this.schedule = this.schedule.bind(context);
    this.open = this.open.bind(context);
    this.waiting = this.waiting.bind(context);
    this.lowestOpenPriority = this.lowestOpenPriority.bind(context);
    this.highestWaitingPriority = this.highestWaitingPriority.bind(context);
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
      this.update(index, priority);
    } else {
      this.push(item);
    }
    return;
  }

  
  
  open() {
    return this.list.count(listItem => listItem.connection.state === AbstractConnection.OPEN);
  }
  lowestOpenPriority() {
    const item = this.list.findLast(listItem => listItem.connection.state === AbstractConnection.OPEN);
    return item ? item.priority : 0;
  }

  waiting() {
    return this.list.count(listItem => listItem.connection.state === AbstractConnection.INIT);
  }
  highestWaitingPriority() {
    const item = this.list.find(listItem => listItem.connection.state === AbstractConnection.INIT);
    return item ? item.priority : 0;
  }
}
