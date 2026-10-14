/**
 * Shrinks a photo before upload. Phone cameras make very large files, and a note is readable at 1600 pixels.
 * The picture is redrawn as a JPEG, which also fixes its rotation and removes location data stored in the file.
 */
export async function prepareImage(source: Blob, maxSide = 1600, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Cannot prepare the photo in this browser.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob === null ? reject(new Error('Cannot prepare the photo.')) : resolve(blob)), 'image/jpeg', quality);
  });
}
