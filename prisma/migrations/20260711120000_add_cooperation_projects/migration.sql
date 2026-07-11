-- CreateTable
CREATE TABLE "cooperation_projects" (
    "id" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "location" JSONB NOT NULL,
    "role" JSONB NOT NULL,
    "partner" JSONB NOT NULL,
    "scale" JSONB NOT NULL,
    "status" JSONB NOT NULL,
    "content_status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cooperation_projects_pkey" PRIMARY KEY ("id")
);
