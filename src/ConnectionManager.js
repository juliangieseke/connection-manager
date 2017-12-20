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
       * @param {List} list - list to work with
       * @param {int} priority
       * @return {bool} - number of free slots
       */
      requestFreeSlot(list, priority) {

        // get last (lowest priority) open connection in list
        const item = list.findLast(listItem =>
          listItem.connection.state === AbstractConnection.OPEN);

        // no open item.
        if (!item) {
          return true;
        }

        // not all slots occupied
        if (list.count(listItem => listItem.connection.state === AbstractConnection.OPEN) < maxConnections) {
          return true;
        }

        // close least important open connection, 
        // if the given one is more important
        if (
          item.priority < priority * threshold
        ) {
          // remove connection from list
          list = list.filter(
            listItem => !listItem.equals(item)
          );
          // TODO die liste muss hier irgendwie raus…
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
       * @param {List} list - list to update
       * @param {int} index - index of existing (open or init) connection
       * @param {int} priority - new priority
       * @return {List} updated list.
       */
      update(list, index, priority) {
        const item = list.get(index);

        // well…
        if (item.priority === priority) {
          return list;
        }

        // if connection is open,
        if (item.connection.state === AbstractConnection.OPEN) {
          // if prio is decreased,
          if (priority < item.priority &&
            // all slots are occupied
            list.count(listItem => listItem.connection.state === AbstractConnection.OPEN) === maxConnections &&
            // and there is a waiting connection with higher prio
            list.find(listItem => listItem.connection.state === AbstractConnection.INIT).priority * threshold > priority
          ) {
            // close async
            setTimeout(() => item.connection.close(), 0);
            // remove connection from list
            return list.filter(
              listItem => !listItem.equals(item)
            );
          } else {
            // update & sort list
            // => see return statement below
          }
        }

        // connection was still in queue
        if (item.connection.state === AbstractConnection.INIT) {
          // if priority increased, 
          if (priority > item.priority &&
            // and there is a free slot
            context.requestFreeSlot(list, item.priority)
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
        return list
          .update(index, listItem => new ConnectionQueueItem(item.connection, priority))
          .sortBy(listItem => -1 * listItem.priority);
      },

      /**
       * Pushes a new item into the list
       * 
       * @param {List} list - list to push in 
       * @param {ConnectionQueueItem} item - new open or init connection
       * @return {List} - updated list
       */
      push(list, item) {

        // it is possible to open connections on your own
        // and then add them to the manager, if this happened and 
        // there is no free slot, we have to kill them now…
        if (item.connection.state === AbstractConnection.OPEN) {
          // if all slots are occipied
          if (list.count(listItem => listItem.connection.state === AbstractConnection.OPEN) === maxConnections) {
            // if lowest open prio is higher then item.prio
            if (list.findLast(listItem => listItem.connection.state === AbstractConnection.OPEN).priority > item.priority * threshold) {
              // we need to close the connection async.
              setTimeout(() => item.connection.close(), 0);
              // done. return untouched list
              return list;
            } else {
              // we need to close an open connection in favor of this one.
              let closeItem = list.findLast(listItem => listItem.connection.state === AbstractConnection.OPEN);
              // close it
              setTimeout(() => closeItem.connection.close(), 0);
              // update list
              list = list.filter(listItem => !listItem.equals(closeItem));
              // continued below!
            }
          }
        }
        // connection.state is INIT or free slot available
        // we can add listeners and store the connection


        // add listeners for handling it - these will 
        // call context.next() when the connection is closed.
        context.addListeners(item.connection);

        // if connection is not opened yet
        if (item.connection.state === AbstractConnection.INIT) {
          // if slot is available
          if (list.count(listItem => listItem.connection.state === AbstractConnection.OPEN) < maxConnections) {
            // open
            context.openConnection(item.connection);
          } else {
            // no slot available, if lowest open prio is lower then item.prio
            if (list.findLast(listItem => listItem.connection.state === AbstractConnection.OPEN).priority > item.priority * threshold) {
              // we need to close an open connection in favor of this one.
              let closeItem = list.findLast(listItem => listItem.connection.state === AbstractConnection.OPEN);
              // close it
              setTimeout(() => closeItem.connection.close(), 0);
              // update list
              list = list.filter(listItem => !listItem.equals(closeItem));
              // and open
              context.openConnection(item.connection);
              // continued below!
            }
          }
        }

        // store it in list
        return list
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
      this.list = this.update(this.list, index, priority);
    } else {
      console.log("pushing…");
      this.list = this.push(this.list, item);
      console.log("…pushed", this.list.size, this.list.count(listItem => listItem.connection.state === AbstractConnection.OPEN));
    }
    return;
  }
}
