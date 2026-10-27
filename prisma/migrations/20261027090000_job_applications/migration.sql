ALTER TABLE "contact_submissions"
ADD COLUMN "application_position_id" TEXT,
ADD COLUMN "application_position_title" TEXT,
ADD COLUMN "application_cv_link" TEXT;

CREATE TABLE "application_cvs" (
  "id" TEXT NOT NULL,
  "submission_id" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "content" BYTEA NOT NULL,
  CONSTRAINT "application_cvs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "application_cvs_submission_id_key" ON "application_cvs"("submission_id");
ALTER TABLE "application_cvs" ADD CONSTRAINT "application_cvs_submission_id_fkey"
FOREIGN KEY ("submission_id") REFERENCES "contact_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
