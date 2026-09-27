/**
 * Attachments / receipts.
 * Metadata lives in `db.attachments`, binary data in `db.attachmentBlobs`
 * (same id) so lists never load blobs. Large photos are compressed before saving.
 */
export { AttachmentPicker, type PendingAttachment } from './AttachmentPicker'
export { AttachmentFileError, MAX_ATTACHMENTS, prepareAttachment } from './prepare-attachment'
