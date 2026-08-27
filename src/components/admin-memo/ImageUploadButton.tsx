'use client';

import { useRef, useState } from 'react';
import { Image, Loader2 } from 'lucide-react';
import { uploadMemoImage } from '@/src/services/memoApi';
import { Button } from '@/src/components/ui';

interface ImageUploadButtonProps {
  onInsert: (markdownImage: string) => void;
}

export function ImageUploadButton({ onInsert }: ImageUploadButtonProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    setProgress(0);
    try {
      const url = await uploadMemoImage(file, setProgress);
      onInsert(`![${file.name}](${url})`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        title="插入图片"
      >
        {uploading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {progress}%
          </>
        ) : (
          <>
            <Image className="h-3.5 w-3.5" />
            图片
          </>
        )}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = '';
        }}
      />
    </>
  );
}

/**
 * 粘贴/拖拽图片处理
 * 在编辑器的 textarea 上监听 paste 和 drop 事件
 */
export function handleImageEvent(
  e: React.ClipboardEvent | React.DragEvent,
  onInsert: (markdownImage: string) => void
) {
  const files =
    'clipboardData' in e
      ? Array.from(e.clipboardData?.files ?? [])
      : Array.from(e.dataTransfer?.files ?? []);

  const imageFiles = files.filter((f) => f.type.startsWith('image/'));
  if (imageFiles.length === 0) return;

  e.preventDefault();
  imageFiles.forEach(async (file) => {
    try {
      const url = await uploadMemoImage(file);
      onInsert(`![${file.name}](${url})`);
    } catch (err) {
      console.error('图片上传失败:', err);
    }
  });
}
