export interface UploadRequest {
  objectKey: string;
  contentType: string;
  byteSize: number;
}

export interface SignedUpload {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}

export interface StoredObjectHead {
  objectKey: string;
  contentType: string;
  byteSize: number;
  etag?: string;
}

export interface StorageProvider {
  createUploadUrl(request: UploadRequest): Promise<SignedUpload>;
  confirmUpload(request: UploadRequest): Promise<StoredObjectHead>;
  createDownloadUrl(objectKey: string): Promise<{ url: string; expiresAt: string }>;
  deleteObject(objectKey: string): Promise<void>;
  headObject(objectKey: string): Promise<StoredObjectHead>;
  readObject(objectKey: string): Promise<Uint8Array>;
}
