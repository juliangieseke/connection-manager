import { AbstractConnection, ConnectionEvent } from "@dcos/connections";
import ConnectionManagerClass from "../ConnectionManager.js";

jest.mock("@dcos/connections", () => {
  return {
    AbstractConnection: require("../__mocks__/AbstractConnection").default,
    ConnectionEvent: require("../__mocks__/ConnectionEvent").default
  };
});

describe("ConnectionManager", () => {
  let ConnectionManager = null;
  let connection1 = null;
  let connection2 = null;
  let connection3 = null;

  beforeEach(() => {
    ConnectionManager = new ConnectionManagerClass(1);
    connection1 = new AbstractConnection("http://example.com/1");
    connection2 = new AbstractConnection("http://example.com/2");
    connection3 = new AbstractConnection("http://example.com/3");
  });

  describe("#queue", function () {
    it("adds abort listeners to new connection", () => {
      ConnectionManager.add(connection1);

      expect(
        connection1.addListener.mock.calls.find(
          args => args[0] === ConnectionEvent.ABORT
        )
      ).toBeTruthy();
    });

    it("adds complete listeners to new connection", () => {
      ConnectionManager.add(connection1);

      expect(
        connection1.addListener.mock.calls.find(
          args => args[0] === ConnectionEvent.COMPLETE
        )
      ).toBeTruthy();
    });

    it("adds error listeners to new connection", () => {
      ConnectionManager.add(connection1);

      expect(
        connection1.addListener.mock.calls.find(
          args => args[0] === ConnectionEvent.ERROR
        )
      ).toBeTruthy();
    });

    it("does not allow enqueueing of closed connections", () => {
      connection1.state = AbstractConnection.CLOSED;

      expect(() => {
        ConnectionManager.add(connection1);
      }).not.toThrow();
    });

    it("opens connection if slot is free and connection not open yet", () => {
      ConnectionManager.add(connection1);

      expect(connection1.open).toHaveBeenCalled();
    });

    it("doesn't open connections twice", () => {
      connection1.open();

      ConnectionManager.add(connection1);

      expect(connection1.open).toHaveBeenCalledTimes(1);
    });

    it("doesn't open connection if there's no free slot", () => {
      ConnectionManager.add(connection1);
      ConnectionManager.add(connection2);

      expect(connection1.open).toHaveBeenCalled();
      expect(connection2.open).not.toHaveBeenCalled();
    });
  });
});
