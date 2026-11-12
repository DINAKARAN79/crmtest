import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';

type UnitFieldRow = [string, string, string, boolean, string];

const rows = JSON.parse(
  readFileSync(join(__dirname, 'salesforce-unit-fields.json'), 'utf8'),
) as UnitFieldRow[];

const statusValues = ['AVAILABLE', 'RESERVED', 'BOOKED', 'HOLD', 'SOLD', 'BLOCKED'];
const typeValues = ['Apartment', 'Plot', 'Villa'];

const picklists: Record<string, string[]> = {
  Status__c: statusValues,
  Unit_Type__c: typeValues,
};

function describe(sourceType: string) {
  if (sourceType === 'Auto Number') return { fieldType: 'text', maxLength: 80, editable: false, readOnly: true };
  if (sourceType.startsWith('Formula')) {
    const inner = sourceType.replace(/^Formula \((.+)\)$/, '$1');
    const fieldType = inner === 'Currency' ? 'currency' : inner === 'Number' ? 'number' : 'text';
    return { fieldType, maxLength: undefined as number | undefined, editable: false, readOnly: true };
  }
  if (sourceType.startsWith('Lookup')) {
    const target = sourceType.replace(/^Lookup\((.+)\)$/, '$1');
    return { fieldType: 'lookup', maxLength: undefined as number | undefined, editable: true, readOnly: false, lookupObject: target };
  }
  if (sourceType === 'Picklist') return { fieldType: 'picklist', maxLength: undefined as number | undefined, editable: true, readOnly: false };
  if (sourceType === 'Date/Time') return { fieldType: 'dateTime', maxLength: undefined as number | undefined, editable: true, readOnly: false };
  const sized = /^(Currency|Number|Text)\((\d+)(?:,\s*(\d+))?\)$/.exec(sourceType);
  if (sized?.[1] === 'Text') return { fieldType: 'text', maxLength: Number(sized[2]), editable: true, readOnly: false };
  if (sized?.[1] === 'Currency') return { fieldType: 'currency', maxLength: undefined as number | undefined, precision: Number(sized[2]), scale: sized[3] ? Number(sized[3]) : 0, editable: true, readOnly: false };
  if (sized?.[1] === 'Number') return { fieldType: 'number', maxLength: undefined as number | undefined, precision: Number(sized[2]), scale: sized[3] ? Number(sized[3]) : 0, editable: true, readOnly: false };
  return { fieldType: 'text', maxLength: undefined as number | undefined, editable: true, readOnly: false };
}

export async function seedUnitFieldsForTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  createdBy: string,
) {
  const names = rows.map((row) => row[1]);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length) throw new Error(`Duplicate Unit field names: ${duplicates.join(', ')}`);

  const existingObject = await tx.objectDefinition.findFirst({
    where: { tenantId, name: 'Unit' },
    select: { id: true, isActive: true },
  });
  if (existingObject && !existingObject.isActive) return 0;
  const object = existingObject ?? await tx.objectDefinition.create({
    data: {
      tenantId,
      name: 'Unit',
      label: 'Unit',
      pluralLabel: 'Units',
      icon: 'building',
      description: 'Manage project units',
      objectType: 'standard',
      createdBy,
      updatedBy: createdBy,
    },
    select: { id: true },
  });

  const definitions = rows.map(([label, name, sourceType, required], index) => {
    const described = describe(sourceType);
    return {
      tenantId,
      objectId: object.id,
      name,
      label,
      fieldType: described.fieldType,
      description: sourceType,
      helpText: described.readOnly
        ? `Calculated from the unit record. Salesforce type: ${sourceType}.`
        : `Salesforce type: ${sourceType}.`,
      required,
      maxLength: described.maxLength,
      precision: 'precision' in described ? described.precision : undefined,
      scale: 'scale' in described ? described.scale : undefined,
      lookupObject: 'lookupObject' in described ? described.lookupObject : undefined,
      visible: true,
      editable: described.editable,
      isActive: true,
      isSystemField: name === 'Name' || name === 'CreatedById' || name === 'LastModifiedById',
      isCustomField: name.endsWith('__c') || name === 'OwnerId',
      isStandardField: !name.endsWith('__c') && name !== 'OwnerId',
      searchable: true,
      sortable: !described.readOnly,
      filterable: described.fieldType === 'picklist' || described.fieldType === 'dateTime',
      displayOrder: index,
      createdBy,
      updatedBy: createdBy,
    };
  });
  const created = await tx.fieldDefinition.createMany({ data: definitions, skipDuplicates: true });

  const fields = await tx.fieldDefinition.findMany({
    where: { tenantId, objectId: object.id, name: { in: Object.keys(picklists) } },
    select: { id: true, name: true },
  });
  for (const field of fields) {
    for (const [displayOrder, value] of picklists[field.name].entries()) {
      await tx.picklistValue.upsert({
        where: { fieldId_value: { fieldId: field.id, value } },
        create: {
          tenantId,
          fieldId: field.id,
          label: value,
          value,
          isActive: true,
          isDefault: displayOrder === 0 && field.name === 'Status__c',
          displayOrder,
        },
        update: {},
      });
    }
  }

  const standardSections = ['Unit Information', 'Area', 'Pricing', 'System']
    .map((name) => ({
      name,
      fields: rows.filter((row) => row[4] === name).map((row) => row[1]),
    }))
    .filter((section) => section.fields.length > 0);
  const layout = await tx.pageLayout.findUnique({
    where: { objectId_name: { objectId: object.id, name: 'Default Layout' } },
  });
  if (!layout) {
    await tx.pageLayout.create({
      data: {
        tenantId,
        objectId: object.id,
        name: 'Default Layout',
        isDefault: true,
        sections: standardSections,
        createdBy,
      },
    });
  } else {
    const storedSections = (typeof layout.sections === 'string'
      ? JSON.parse(layout.sections)
      : layout.sections) as Array<{ name: string; fields?: string[] }>;
    const sections = Array.isArray(storedSections) ? [...storedSections] : [];
    for (const standardSection of standardSections) {
      const existing = sections.find((section) => section.name === standardSection.name);
      if (existing) {
        existing.fields = [...new Set([...(existing.fields ?? []), ...standardSection.fields])];
      } else {
        sections.push(standardSection);
      }
    }
    await tx.pageLayout.update({
      where: { id: layout.id },
      data: { sections, updatedBy: createdBy },
    });
  }
  return created.count;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
    for (const tenant of tenants) {
      const user = await prisma.user.findFirst({
        where: { tenantId: tenant.id, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!user) {
        console.warn(`Skipping ${tenant.name}: no active user is available for metadata ownership.`);
        continue;
      }
      const count = await prisma.$transaction((tx) => seedUnitFieldsForTenant(tx, tenant.id, user.id));
      console.log(`${tenant.name}: created ${count} Unit fields.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if ((process.argv[1] || '').includes('seed-unit-fields')) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
