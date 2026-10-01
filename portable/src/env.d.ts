/// <reference types="vite/client" />

interface PortableWritable {
  close(): Promise<void>;
  write(data: string): Promise<void>;
}

interface PortableFileHandle {
  createWritable(): Promise<PortableWritable>;
  getFile(): Promise<File>;
  name: string;
}

interface Window {
  showOpenFilePicker?: (options?: unknown) => Promise<PortableFileHandle[]>;
}
