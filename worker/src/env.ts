import type { Directory } from './directory';
import type { TemplateRoom } from './room';

export interface Env {
  DIRECTORY: DurableObjectNamespace<Directory>;
  ROOM: DurableObjectNamespace<TemplateRoom>;
  ASSETS: Fetcher;
}
