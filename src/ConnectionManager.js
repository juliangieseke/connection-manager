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
  constructor(maxConnections = 6, maxAge = 6000, maxAutoPriority = 3) {
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
       * @property {ConnectionQueue} interval
       * @description Internal loop interval
       * @name ConnectionManager~Context#interval
       */
      interval: null,

      /**
       * @property {function} handleConnectionComplete
       * @name ConnectionManager~Context#handleConnectionComplete
       * @param {ConnectionEvent} event
       */
      handleConnectionClose: event => {
        // remove listeners from connection
        context.removeListeners(event.target);
      },

      /**
       * Opens a Connection
       * 
       * @param {AbstractConnection} connection
       */
      openConnection(connection) {
        // add listeners
        context.addListeners(connection);
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

      /**
       * This function is where the magic happens.
       */
      loop() {
        // store all open items
        let openList = context.list.filter(listItem => 
          listItem.connection.state === AbstractConnection.OPEN
        );
        
        let waitingList = context.list
          .filter(listItem => 
            listItem.connection.state === AbstractConnection.INIT
          )
          // increase priority on old items
          .map((listItem) => {
            if (
              listItem.priority < maxAutoPriority && 
              listItem.created < Date.now() - maxAge
            ) {
              return new ConnectionQueueItem(listItem.connection, listItem.priority+1);
            }
            return listItem;
          })
          // and sort
          .sortBy(listItem => -1 * listItem.priority);

        // open a connection if possible
        if (waitingList.size && openList.size < maxConnections) {
          context.openConnection(waitingList.first().connection);
        }

        // merge them again.
        context.list = openList.concat(waitingList);

        // still waiting items? 
        if(waitingList.size > 0) {
          const delay = (maxConnections * openList.size);
          context.interval = setTimeout(
            context.loop, 
            delay
          ) 
        } else {
          context.interval = null;
        }
      },

      schedule(connection, priority) {

        // create a new QueueItem to have the correct default priority
        const item = new ConnectionQueueItem(connection, priority);

        // if we got a (now) closed connection, nothing to do.
        if (connection.state === AbstractConnection.CLOSED) {
          return;
        }
    
        // add, sort and process
        context.list = context.list
          .filter(listItem => !listItem.equals(item))
          .push(item);

        // running loop? otherwise start it
        if(!context.interval) {
          context.loop();
        }

        
      }
    };

    this.schedule = this.schedule.bind(context);
  }

  /**
   * Calls internal schedule method
   *
   * @this ConnectionManager~Context
   * @param {AbstractConnection} connection – connection to queue
   * @param {Integer} [priority] – optional change of priority
   */
  schedule(connection, priority) {
    this.schedule(connection, priority);
  }
}
