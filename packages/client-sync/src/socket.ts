export interface SyncSocket {
  send(data: Uint8Array<ArrayBuffer>): void;
  close(): void;
}

export type SocketHandlers = {
  open(): void;
  message(data: Uint8Array): void;
  close(): void;
};

export type Connect = (url: string, handlers: SocketHandlers) => SyncSocket;

export const connectWebSocket: Connect = (url, handlers) => {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  socket.onopen = () => handlers.open();
  socket.onclose = () => handlers.close();
  socket.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      handlers.message(new Uint8Array(event.data));
      return;
    }
    socket.close(1003, "frames are binary CBOR");
  };
  return socket;
};
