ALTER TABLE "NewPermissionSet"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "notes" TEXT;

ALTER TABLE "RRQueue"
  ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'Sales';

ALTER TABLE "RRQueueMember"
  ADD COLUMN IF NOT EXISTS "activeDurationMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "activeSince" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdById" TEXT,
  ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deactivatedByProfile" TEXT,
  ADD COLUMN IF NOT EXISTS "lastAssignedTime" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "lastAssignedTimeUser" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "lastSiteVisitAssignedTime" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "lastUnqualifiedLeadAssignedTime" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "lastModifiedByUser" TEXT,
  ADD COLUMN IF NOT EXISTS "ownerId" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedById" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'RRQueueMember_createdById_fkey'
      AND conrelid = '"RRQueueMember"'::regclass
  ) THEN
    ALTER TABLE "RRQueueMember" ADD CONSTRAINT "RRQueueMember_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'RRQueueMember_ownerId_fkey'
      AND conrelid = '"RRQueueMember"'::regclass
  ) THEN
    ALTER TABLE "RRQueueMember" ADD CONSTRAINT "RRQueueMember_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'RRQueueMember_updatedById_fkey'
      AND conrelid = '"RRQueueMember"'::regclass
  ) THEN
    ALTER TABLE "RRQueueMember" ADD CONSTRAINT "RRQueueMember_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "BookingRefundRequest" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "requestNumber" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL,
  "accountHolderName" TEXT NOT NULL,
  "encryptedAccountNumber" TEXT NOT NULL,
  "accountNumberIv" TEXT NOT NULL,
  "accountNumberTag" TEXT NOT NULL,
  "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
  "ifscCode" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  "approvalNote" TEXT,
  "createdById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BookingRefundRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingRefundRequest_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BookingRefundRequest_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BookingRefundRequest_tenantId_requestNumber_key"
  ON "BookingRefundRequest"("tenantId", "requestNumber");
CREATE INDEX IF NOT EXISTS "BookingRefundRequest_tenantId_status_createdAt_idx"
  ON "BookingRefundRequest"("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "BookingRefundRequest_tenantId_bookingId_createdAt_idx"
  ON "BookingRefundRequest"("tenantId", "bookingId", "createdAt");
