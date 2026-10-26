ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "password_change_codes" ("id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "code_hash" TEXT NOT NULL, "password_fingerprint" TEXT NOT NULL, "email" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0, "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expires_at" TIMESTAMP(3) NOT NULL, "used_at" TIMESTAMP(3), CONSTRAINT "password_change_codes_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "password_change_codes_user_id_key" ON "password_change_codes"("user_id");
ALTER TABLE "password_change_codes" ADD CONSTRAINT "password_change_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
