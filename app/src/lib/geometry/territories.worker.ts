import { Territories, type Reply, type Request } from "./territories";

// `tsconfig` has the DOM lib, not WebWorker, and the DOM `postMessage` is the window's.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(reply: Reply): void;
};

const territories = new Territories();
scope.onmessage = (e) => scope.postMessage(territories.handle(e.data));
