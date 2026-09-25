-- Cho phép banner chỉ dùng ảnh, không bắt buộc overlay chữ từ CMS.
-- Trường hợp ảnh banner đã có chữ sẵn nếu ép nhập `title` sẽ gây chồng nội dung
-- trên website công khai.
ALTER TABLE "banners" ALTER COLUMN "title" DROP NOT NULL;
