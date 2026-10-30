-- Cập nhật địa chỉ cũ đã xác nhận, giữ nguyên thông tin liên hệ và địa chỉ tùy chỉnh.
UPDATE "site_settings"
SET "value" = jsonb_set(
  "value",
  '{address}',
  ("value"->'address') || jsonb_build_object(
    'vi', '1D Trần Não, Khu Phố 5, An Khánh, Hồ Chí Minh 71322, Việt Nam',
    'en', CASE
      WHEN COALESCE("value"#>>'{address,en}', '') IN (
        '',
        'No. 10 Tran Nao Street, Quarter 5, Binh Trung Ward, Ho Chi Minh City, Vietnam'
      ) THEN '1D Tran Nao Street, Quarter 5, An Khanh Ward, Ho Chi Minh City 71322, Vietnam'
      ELSE "value"#>>'{address,en}'
    END
  )
), "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'company-contact'
  AND "value"#>>'{address,vi}' = 'Số 10 Trần Não, KP5, P. Bình Trưng, TP. Hồ Chí Minh, Việt Nam';
