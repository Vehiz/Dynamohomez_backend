import { PrismaClient, AppRole, PropertyStatus, PropertyVerificationStatus, UnitAvailabilityStatus, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'demo.roommate@example.com' },
    update: {},
    create: {
      email: 'demo.roommate@example.com',
      phone: '+2348010000000',
      passwordHash: null,
      status: UserStatus.ACTIVE,
      roles: {
        create: [
          { role: AppRole.USER },
          { role: AppRole.ROOMMATE_SEEKER },
          { role: AppRole.TENANT },
        ],
      },
      profile: {
        create: {
          firstName: 'Demo',
          lastName: 'User',
          profilePhoto: null,
          bio: 'Fictional seed user for local development.',
          occupation: 'Designer',
          city: 'Lagos',
          state: 'Lagos',
          country: 'Nigeria',
        },
      },
    },
    include: { profile: true, roles: true },
  });

  const property = await prisma.property.create({
    data: {
      ownerId: user.id,
      propertyType: 'shared-apartment',
      title: 'Demo Shared Apartment in Lekki',
      description: 'Fictional seed property for development and marketplace search testing.',
      address: '12 Admiralty Way',
      city: 'Lagos',
      state: 'Lagos',
      lga: 'Eti-Osa',
      area: 'Lekki Phase 1',
      latitude: 6.4541,
      longitude: 3.4727,
      verificationStatus: PropertyVerificationStatus.VERIFIED,
      status: PropertyStatus.ACTIVE,
      units: {
        create: [
          {
            unitType: 'shared-room',
            name: 'Room B',
            bedroomCount: 1,
            bathroomCount: 1,
            rent: 850000,
            serviceCharge: 50000,
            deposit: 100000,
            availabilityStatus: UnitAvailabilityStatus.AVAILABLE,
          },
        ],
      },
    },
    include: { units: true },
  });

  console.log('Seeded user:', user.email, 'property:', property.title);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });