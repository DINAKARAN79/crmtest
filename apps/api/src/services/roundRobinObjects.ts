import { Prisma, prisma } from '@dct-crm/db';
import { REPORT_OBJECTS } from '../reports/report-metadata';

type Database = Prisma.TransactionClient | typeof prisma;

const ROUND_ROBIN_OBJECTS = [
  {
    name: 'RRQueue',
    label: 'Round Robin',
    pluralLabel: 'Round Robin',
    icon: 'users-round',
    description: 'Manage round-robin lead assignment queues',
  },
  {
    name: 'RRQueueMember',
    label: 'Round Robin Member',
    pluralLabel: 'Round Robin Members',
    icon: 'users',
    description: 'Manage round-robin queue members',
  },
] as const;

const FULL_ACCESS = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
  viewAll: true,
  modifyAll: true,
};

function fieldTypeForReport(type: string) {
  if (type === 'number') return 'number';
  if (type === 'date') return 'dateTime';
  if (type === 'enum') return 'picklist';
  return 'text';
}

function lookupObjectForField(objectName: string, fieldName: string) {
  if (objectName === 'RRQueue') {
    if (fieldName === 'ownerId' || fieldName === 'defaultOwnerId') return 'User';
    if (fieldName === 'projectId') return 'Project';
  }
  if (objectName === 'RRQueueMember') {
    if (fieldName === 'userId') return 'User';
    if (fieldName === 'rrQueueId') return 'RRQueue';
  }
  return undefined;
}

export async function ensureRoundRobinObjects(db: Database, tenantId: string, actorId: string) {
  for (const definition of ROUND_ROBIN_OBJECTS) {
    let object = await db.objectDefinition.findFirst({
      where: { tenantId, name: definition.name },
      select: { id: true },
    });
    if (!object) {
      object = await db.objectDefinition.create({
        data: {
          tenantId,
          ...definition,
          objectType: 'standard',
          isAvailableInNavigation: false,
          isAvailableInReports: true,
          createdBy: actorId,
          updatedBy: actorId,
        },
        select: { id: true },
      });
    }
    await db.objectDefinition.update({
      where: { id: object.id },
      data: {
        ...definition,
        objectType: 'standard',
        isAvailableInNavigation: false,
        isAvailableInReports: true,
        updatedBy: actorId,
      },
    });

    const reportObject = REPORT_OBJECTS[definition.name];
    const fields = Object.entries(reportObject.fields).map(([name, field], displayOrder) => ({
      tenantId,
      objectId: object!.id,
      name,
      label: field.label,
      fieldType: definition.name === 'RRQueue' && ['leadSource', 'category', 'leadStatus', 'secondarySource', 'tertiarySource', 'leadPriority', 'projectInterested', 'country'].includes(name)
        ? 'multiPicklist'
        : fieldTypeForReport(field.type),
      required: false,
      searchable: true,
      sortable: true,
      filterable: true,
      visible: true,
      editable: false,
      isActive: true,
      isSystemField: false,
      isCustomField: false,
      isStandardField: true,
      displayOrder,
      lookupObject: lookupObjectForField(definition.name, name),
      createdBy: actorId,
    }));
    await db.fieldDefinition.createMany({ data: fields, skipDuplicates: true });
    await Promise.all(fields.map(({ name, label, fieldType, displayOrder, lookupObject }) =>
      db.fieldDefinition.updateMany({
        where: { tenantId, objectId: object.id, name },
        data: {
          label,
          fieldType,
          displayOrder,
          visible: true,
          editable: false,
          isSystemField: false,
          isCustomField: false,
          isStandardField: true,
          ...(lookupObject ? { lookupObject } : {}),
        },
      }),
    ));

    const layout = await db.pageLayout.findFirst({
      where: { tenantId, objectId: object!.id, isDefault: true },
      select: { id: true },
    });
    if (!layout) {
      await db.pageLayout.create({
        data: {
          tenantId,
          objectId: object!.id,
          name: 'Default Layout',
          isDefault: true,
          sections: [{ name: `${definition.label} Information`, fields: fields.map(({ name }) => name) }],
          createdBy: actorId,
        },
      });
    }

    const [adminProfiles, adminRole] = await Promise.all([
      db.profile.findMany({ where: { tenantId, isAdmin: true }, select: { id: true } }),
      db.role.findFirst({ where: { tenantId, name: 'Admin' }, select: { id: true } }),
    ]);
    if (adminProfiles.length) {
      await db.profileObjectPermission.createMany({
        data: adminProfiles.map(({ id: profileId }) => ({
          tenantId,
          profileId,
          objectId: object!.id,
          ...FULL_ACCESS,
        })),
        skipDuplicates: true,
      });
    }
    if (adminRole) {
      await db.objectPermission.createMany({
        data: [{ tenantId, roleId: adminRole.id, objectId: object.id, ...FULL_ACCESS }],
        skipDuplicates: true,
      });
    }
  }
}

const ensuredTenants = new Set<string>();

export function clearRoundRobinObjectEnsureCache() {
  ensuredTenants.clear();
}

export async function ensureRoundRobinObjectsOnce(tenantId: string) {
  if (ensuredTenants.has(tenantId)) return;
  await ensureRoundRobinObjects(prisma, tenantId, 'system');
  ensuredTenants.add(tenantId);
}
