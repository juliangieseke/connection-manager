import { List } from "immutable";
import { AbstractConnection, ConnectionEvent } from "@dcos/connections";
import ConnectionQueueItem from "./ConnectionQueueItem";

export default class ConnectionManager {
  /**
   * Initializes an Instance of ConnectionManager
   *
   * @param {int} maxConnections – max open connections
   * @param {float} threshold - only kill connections with a priority < newPriority * threshold
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
       * @property {function} handleConnectionComplete
       * @name ConnectionManager~Context#handleConnectionComplete
       * @param {ConnectionEvent} event
       */
      handleConnectionClose: event => {
        const item = new ConnectionQueueItem(event.target);

        // remove listeners from connection
        context.removeListeners(item.connection);

        // start next connection from queue (if any)
        context.list = context.process(
          context.list.filter(listItem => 
            !listItem.equals(item)
          )
        );
      },

      /**
       * Opens a Connection
       * 
       * @param {AbstractConnection} connection
       */
      openConnection(connection) {
        // open connection (later: with token)
        connection.open();
      },

      /**
       * Adds Listeners to Connection
       * 
       * @param {AbstractConnection} connection 
       */
      addListeners(connection) {
        connection.addListener(
          ConnectionEvent.ABORT,
          context.handleConnectionClose
        );
        connection.addListener(
          ConnectionEvent.COMPLETE,
          context.handleConnectionClose
        );
        connection.addListener(
          ConnectionEvent.ERROR,
          context.handleConnectionClose
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
          context.handleConnectionClose
        );
        connection.removeListener(
          ConnectionEvent.COMPLETE,
          context.handleConnectionClose
        );
        connection.removeListener(
          ConnectionEvent.ERROR,
          context.handleConnectionClose
        );
      },

      process(list) {

        // preparation: split list into open & waiting
        let openList = list.filter(listItem => 
          listItem.connection.state === AbstractConnection.OPEN
        );
        let waitingList = list.filter(listItem => 
          listItem.connection.state === AbstractConnection.INIT
        );

        // first: close connections if needed
        while (openList.size > maxConnections) {
          const openItem = openList.last();
          openList = openList.pop();
          openItem.connection.close();
        }

        //second: open more connections if possible
        while (waitingList.size && openList.size < maxConnections) {
          const waitingItem = waitingList.first();
          waitingList = waitingList.shift();
          context.openConnection(waitingItem.connection);
          openList = openList.push(waitingItem);
        }

        //third: sort openList
        openList = openList.sortBy(listItem => -1 * listItem.priority);

        //fourth: close low priority connections in favor of higher prio ones
        while (
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
          context.openConnection(waitingItem.connection);

          //this time we need to sort for the next iteration…
          openList = openList.push(waitingItem).sortBy(listItem => -1 * listItem.priority);
        }

        //return and merge them again.
        return openList.concat(waitingList);
      }
    };

    this.schedule = this.schedule.bind(context);
    this.list = this.list.bind(context);
  }

  /**
   * Schedules given connection with given priority
   *
   * @this ConnectionManager~Context
   * @param {AbstractConnection} connection – connection to queue
   * @param {Integer} [priority] – optional change of priority
   * @return {void} - returns nothing.
   */
  schedule(connection, priority) {
    // we got a closed connection, nothing to do.
    if (connection.state === AbstractConnection.CLOSED) {
      return;
    }

    // create a new QueueItem to have the correct default priority
    const item = new ConnectionQueueItem(connection, priority);

    // add listeners if connection is new
    if (!item.connection.listeners(ConnectionEvent.ABORT).find(listener => 
      listener === this.handleConnectionAbort)
    ) {
      this.addListeners(item.connection);
    } else {
      // else remove item from list
      this.list = this.list.filter(listItem => !listItem.equals(item));
    }

    // add, sort and process
    this.list = this.process(
      this.list
        .push(item)
        .sortBy(listItem => -1 * listItem.priority)
    );

    return;
  }


  /**
   * returns a copy of the current list with 
   * a reduced representation of the connections
   * 
   * @this ConnectionManager~Context
   * @return {List}
   */
  list() {
    return this.list.map(listItem => {
      return {
        connection: {
          url: listItem.connection.url,
          state: listItem.connection.state
        }, 
        priority: listItem.priority
      };
    });
  }

}
