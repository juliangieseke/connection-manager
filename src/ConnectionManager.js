import { List } from "immutable";
import { AbstractConnection, ConnectionEvent } from "@dcos/connections";
import ConnectionQueueItem from "./ConnectionQueueItem";

const PRIORITY_STUDENT = 1;
const PRIORITY_BATCH = 2;
const PRIORITY_INTERACTIVE = 3;
const PRIORITY_SYSTEM = 4;

export default class ConnectionManager {

  static get PRIORITY_STUDENT() {
    return PRIORITY_STUDENT;
  }
  static get PRIORITY_BATCH() {
    return PRIORITY_BATCH;
  }
  static get PRIORITY_INTERACTIVE() {
    return PRIORITY_INTERACTIVE;
  }
  static get PRIORITY_SYSTEM() {
    return PRIORITY_SYSTEM;
  }

  /**
   * Initializes an Instance of ConnectionManager
   *
   * @param {int} maxConnections – max open connections
   */
  constructor(maxConnections = 5, maxAutoPriority = PRIORITY_INTERACTIVE) {
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
       * @property {ConnectionQueue} paused
       * @description paused
       * @name ConnectionManager~Context#paused
       */
      paused: false,

      /**
       * @property {ConnectionQueue} token
       * @description token
       * @name ConnectionManager~Context#token
       */
      token: null,

      /**
       * Opens a Connection
       * 
       * @param {AbstractConnection} connection
       */
      setupConnection(connection) {
        connection.open({Authentication: `Bearer ${this.token}`});
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
          // this code would increase priority on old items, after they lived in the line for more then 30s.
          // It is possible better to do this for every connection itself instead of doing it globally
          // here, porbably not all connections need to increase their priority.
          // .map((listItem) => {
          //   if (listItem.priority >= maxAutoPriority) {
          //     return listItem;
          //   }

          //   if(listItem.created < Date.now() - 30000) {
          //     return new ConnectionQueueItem(listItem.connection, listItem.priority+1);
          //   }

          //   return listItem;
          // })
          // and sort
          .sortBy(listItem => -1 * listItem.priority);
        
        // if there are free slots, start as much tasks as possible
        // this has to be a while because otherwise only one connection
        // per second would be opened when the tab is inactive.
        // see https://stackoverflow.com/questions/15871942/how-do-browsers-pause-change-javascript-when-tab-or-window-is-not-active
        while(waitingList.size && openList.size < maxConnections) {
          const waitingItem = waitingList.first();
          waitingList = waitingList.shift();
          context.setupConnection(waitingItem.connection);
          openList = openList.push(waitingItem);
        }

        // merge the lists again (this removes closed connections).
        context.list = openList.concat(waitingList);

        // still waiting items? 
        if(!context.paused && waitingList.size > 0) {
          const delay = 250;
          context.interval = setTimeout(
            context.loop, 
            delay
          );
        } else {
          context.interval = null;
        }
      },

      /**
     * schedules connection in loop
     *
     * @this ConnectionManager~Context
     * @param {AbstractConnection} connection – connection to queue
     * @param {Integer} [priority] – optional change of priority
     * @return {AbstractConnection} - the scheduled connection
     */
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
        if(!context.paused && !context.interval) {
          context.interval = setTimeout(
            context.loop, 
            0
          );
        }

        return connection;
      }
    };

    this.schedule = this.schedule.bind(context);
    
    this.setToken = this.setToken.bind(context);

    this.pause = this.pause.bind(context);
    this.resume = this.resume.bind(context);

    this.list = this.list.bind(context);
  }

  /**
   * Calls internal schedule method
   *
   * @this ConnectionManager~Context
   * @param {AbstractConnection} connection – connection to queue
   * @param {Integer} [priority] – optional change of priority
   * @return {AbstractConnection} - the scheduled connection
   */
  schedule(connection, priority) {
    return this.schedule(connection, priority);
  }

  /**
   * pauses the loop processing
   *
   * @this ConnectionManager~Context
   */
  pause() { 
    this.paused = true;
    if(this.interval) {
      window.clearTimeout(this.interval);
      this.interval = null
    }
  }

  /**
   * resumes the loop processing
   *
   * @this ConnectionManager~Context
   */
  resume() { 
    this.paused = false;
    if(!this.paused && !this.interval && this.list.filter(listItem => 
        listItem.connection.state === AbstractConnection.INIT
    )) {
      this.interval = setTimeout(
        this.loop, 
        0
      );
    }
  }

  /**
   * Updates stored token to authenticate requests
   * 
   * @param {string} token - valid token
   */
  setToken(token) {
    this.token = token;
  }

  /**
   * debugging method, returns list
   *
   * @this ConnectionManager~Context
   * @return {List} - connectionList
   */
  list() { 
    return this.list;
  }
}
