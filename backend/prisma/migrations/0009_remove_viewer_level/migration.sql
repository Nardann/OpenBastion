-- Remove the VIEWER access level. It was redundant with OPERATOR for every
-- practical use, so existing VIEWER grants are demoted to OPERATOR and the
-- enum is recreated without the value.

-- 1. Demote any existing VIEWER permissions to OPERATOR.
UPDATE "Permission" SET "level" = 'OPERATOR' WHERE "level" = 'VIEWER';

-- 2. Recreate the AccessLevel enum without VIEWER.
ALTER TYPE "AccessLevel" RENAME TO "AccessLevel_old";
CREATE TYPE "AccessLevel" AS ENUM ('OWNER', 'OPERATOR');
ALTER TABLE "Permission" ALTER COLUMN "level" DROP DEFAULT;
ALTER TABLE "Permission" ALTER COLUMN "level" TYPE "AccessLevel" USING ("level"::text::"AccessLevel");
ALTER TABLE "Permission" ALTER COLUMN "level" SET DEFAULT 'OPERATOR';
DROP TYPE "AccessLevel_old";
