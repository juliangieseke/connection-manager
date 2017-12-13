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
  constructor(maxConnections = 6) {
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
      waitingList: List(),

      /**
       * @property {List} openList
       * @description List of open connections
       * @name ConnectionManager~Context#next
       */
      openList: List(),

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
          item.connection.open();
        }

        if (
          item.connection.state === AbstractConnection.OPEN &&
          !context.openList.some(listItem => listItem.equals(item))
        ) {
          context.openList = context.openList
            .push(item)
            .sortBy(listItem => -1 * listItem.priority);
        }

        context.waitingList = context.waitingList.shift(item);

        context.next();
      },

      /**
       * @property {function} handleConnectionAbort
       * @name ConnectionManager~Context#handleConnectionAbort
       * @param {ConnectionEvent} event
       */
      handleConnectionAbort: event =>
        this.dequeue(event.target),

      /**
       * @property {function} handleConnectionComplete
       * @name ConnectionManager~Context#handleConnectionComplete
       * @param {ConnectionEvent} event
       */
      handleConnectionComplete: event =>
        this.dequeue(event.target),

      /**
       * @property {function} handleConnectionError
       * @name ConnectionManager~Context#handleConnectionError
       * @param {ConnectionEvent} event
       */
      handleConnectionError: event =>
        this.dequeue(event.target),

      /**
       * Closes low prio connections until a slot is free
       *
       * @param {int} threshold
       * @return {bool} - true if there is a free slot, false if not.
       */
      closeConnections(threshold) {
        let item = this.openList.last();
        while (
          item &&
          this.openList.size >= maxConnections - 1 &&
          item.priority < threshold
        ) {
          this.instance.dequeue(item.connection);
          item = this.openList.last();
        }
        return this.openList.size <= maxConnections - 1;
      }
    };

    this.enqueue = this.enqueue.bind(context);
    this.dequeue = this.dequeue.bind(context);
    this.force = this.force.bind(context);
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
    if (connection.state === AbstractConnection.CLOSED) {
      return false;
    }

    const item = new ConnectionQueueItem(connection, priority);

    // default case: connection is initialized, but not yet started
    if (connection.state === AbstractConnection.INIT) {
      this.waitingList = this.waitingList
        .push(item)
        .sortBy(listItem => -1 * listItem.priority);
    }

    // theoreticly it is possible to open connections on your own
    // and then add them to the manager, if this happens we have
    // to deal with them correctly
    if (connection.state === AbstractConnection.OPEN) {
      if (this.openList.some(listItem => listItem.equals(item))) {
        return false;
      }
      
      if (this.closeConnections(item.priority)) {
        this.openList = this.openList
          .push(item)
          .sortBy(listItem => -1 * listItem.priority);
      } else {
        connection.abort();
        return false;
      }
    }

    connection.addListener(ConnectionEvent.ABORT, this.handleConnectionAbort);

    connection.addListener(
      ConnectionEvent.COMPLETE,
      this.handleConnectionComplete
    );

    connection.addListener(ConnectionEvent.ERROR, this.handleConnectionError);

    // important: when it returns true here, the connection
    // might already been started in the next()-loop.
    this.next();
    return true;
  }

  /**
   * Dequeues given connection
   *
   * @this ConnectionManager~Context
   * @param {AbstractConnection} connection – connection to dequeue
   */
  dequeue(connection) {
    if (connection.state === AbstractConnection.CLOSED) {
      return false;
    }

    const item = new ConnectionQueueItem(connection);

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

    if (connection.state === AbstractConnection.INIT) {
      this.waitingList = this.waitingList.filter(
        listItem => !listItem.equals(item)
      );
    }

    if (connection.state === AbstractConnection.OPEN) {
      connection.close();
      this.openList = this.openList.filter(
        listItem => !listItem.equals(item)
      );
      this.next();
    }
  }

  /**
   * Immediatly opens a given connection, cancels other connections if needed
   *
   * @this ConnectionManager~Context
   * @param {AbstractConnection} connection
   */
  force(connection) {
    const item = new ConnectionQueueItem(connection, Number.MAX_SAFE_INTEGER);

    if (!this.closeConnections(item.priority)) {
      return false;
    }

    if (item.connection.state === AbstractConnection.INIT) {
      item.connection.open();
    }

    if (item.connection.state === AbstractConnection.OPEN) {
      context.openList = context.openList.enqueue(item);
    }
  }
}
