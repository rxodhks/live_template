import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

/*
 * 아주 작은 파일 기반 저장소.
 * - 모든 쓰기는 임시 파일에 쓴 뒤 rename 하여 원자적으로 교체한다 (저장 중 종료돼도 파일이 깨지지 않음).
 * - 잦은 변경은 debounce로 묶되 maxWait 안에는 반드시 저장한다.
 */

export function dataPath(...parts: string[]): string {
  return path.join(config.dataDir, ...parts);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

function atomicWriteSync(file: string, data: string | Uint8Array): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

const pending = new Set<DebouncedWriter>();

/** debounce + maxWait 저장 스케줄러 */
export class DebouncedWriter {
  private timer: NodeJS.Timeout | null = null;
  private firstScheduledAt = 0;
  private writing: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly write: () => Promise<void>,
    private readonly writeSync: () => void,
    private readonly delay = config.saveDebounceMs,
  ) {}

  schedule(): void {
    const now = Date.now();
    if (!this.timer) this.firstScheduledAt = now;
    else clearTimeout(this.timer);
    const waited = now - this.firstScheduledAt;
    const delay = waited >= config.saveMaxWaitMs ? 0 : this.delay;
    pending.add(this);
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.writing) {
      this.again = true;
      return this.writing;
    }
    pending.delete(this);
    this.writing = this.write()
      .catch((err) => console.error('[store] 저장 실패', err))
      .finally(() => {
        this.writing = null;
        if (this.again) {
          this.again = false;
          void this.flush();
        }
      });
    return this.writing;
  }

  /** 프로세스 종료 직전 동기 저장 */
  flushSync(): void {
    if (!this.timer && !this.again) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.again = false;
    pending.delete(this);
    try {
      this.writeSync();
    } catch (err) {
      console.error('[store] 동기 저장 실패', err);
    }
  }

  get isPending(): boolean {
    return this.timer !== null || this.writing !== null;
  }
}

export function flushAllSync(): void {
  for (const w of Array.from(pending)) w.flushSync();
}

/** JSON 파일 하나를 메모리에 올려두고 변경 시 자동 저장 */
export class JsonFile<T> {
  data: T;
  private writer: DebouncedWriter;

  constructor(
    readonly file: string,
    fallback: () => T,
  ) {
    this.data = JsonFile.read(file) ?? fallback();
    this.writer = new DebouncedWriter(
      () => atomicWrite(file, JSON.stringify(this.data)),
      () => atomicWriteSync(file, JSON.stringify(this.data)),
    );
  }

  static read<T>(file: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[store] 읽기 실패', file, err);
      return null;
    }
  }

  save(): void {
    this.writer.schedule();
  }

  flush(): Promise<void> {
    return this.writer.flush();
  }

  delete(): void {
    this.writer.flushSync();
    fs.rmSync(this.file, { force: true });
  }
}

export function readBinary(file: string): Uint8Array | null {
  try {
    return new Uint8Array(fs.readFileSync(file));
  } catch {
    return null;
  }
}

export function binaryWriter(file: string, getData: () => Uint8Array): DebouncedWriter {
  return new DebouncedWriter(
    () => atomicWrite(file, getData()),
    () => atomicWriteSync(file, getData()),
  );
}

export function writeBinarySync(file: string, data: Uint8Array): void {
  atomicWriteSync(file, data);
}

export function removeFile(file: string): void {
  fs.rmSync(file, { force: true });
}
