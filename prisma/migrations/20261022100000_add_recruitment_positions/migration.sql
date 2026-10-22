ALTER TYPE "ContentStatus" ADD VALUE 'ARCHIVED';

CREATE TABLE "recruitment_positions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "department" JSONB NOT NULL,
    "location" JSONB NOT NULL,
    "type" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "responsibilities" JSONB NOT NULL,
    "requirements" JSONB NOT NULL,
    "benefits" JSONB NOT NULL,
    "deadline" DATE,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recruitment_positions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recruitment_positions_slug_key"
ON "recruitment_positions"("slug");

CREATE INDEX "recruitment_positions_public_idx"
ON "recruitment_positions"("status", "deadline", "order");
