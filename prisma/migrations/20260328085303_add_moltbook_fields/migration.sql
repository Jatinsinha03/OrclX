-- AlterTable
ALTER TABLE "users" ADD COLUMN     "moltbook_api_key" TEXT,
ADD COLUMN     "moltbook_claim_url" TEXT,
ADD COLUMN     "moltbook_verified" BOOLEAN NOT NULL DEFAULT false;
