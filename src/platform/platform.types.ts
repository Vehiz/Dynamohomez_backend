export type ListingRecord = {
  id: string;
  propertyId?: string;
  unitId?: string;
  title: string;
  type: 'rent' | 'sale' | 'shared' | 'roommate' | 'spare-room';
  category: 'residential' | 'commercial' | 'office' | 'land';
  price: number;
  priceType: 'monthly' | 'yearly' | 'per-person' | 'per-desk';
  location: {
    state: string;
    city: string;
    area: string;
    address: string;
  };
  bedrooms: number;
  bathrooms: number;
  size: number;
  furnished: 'furnished' | 'semi-furnished' | 'unfurnished';
  utilitiesIncluded: {
    electricity: boolean;
    water: boolean;
    internet: boolean;
    security: boolean;
    gas: boolean;
  };
  images: string[];
  amenities: string[];
  description: string;
  availableFrom: string;
  availabilityStatus: 'available' | 'occupied' | 'pending';
  postedDate: string;
  postedBy: 'owner' | 'tenant';
  posterName: string;
  posterContact: string;
  verified: boolean;
  listingVerificationStatus?: 'verified' | 'pending' | 'unverified';
  hostVerificationSubmitted?: boolean;
  propertyVerificationStatus?: 'verified' | 'pending' | 'rejected' | 'unverified' | 'in-review' | 'expired';
  property?: PropertyRecord;
  propertyUnit?: PropertyUnitRecord;
};

export type PropertyRecord = {
  id: string;
  ownerId: string;
  propertyType: string;
  title: string;
  description: string;
  address: string;
  city: string;
  state: string;
  lga?: string;
  area: string;
  latitude?: number;
  longitude?: number;
  verificationStatus: 'pending' | 'in-review' | 'verified' | 'rejected' | 'expired' | 'unverified';
  status: 'active' | 'inactive' | 'archived';
  createdAt: string;
  updatedAt: string;
};

export type PropertyUnitRecord = {
  id: string;
  propertyId: string;
  unitType: string;
  name: string;
  bedroomCount: number;
  bathroomCount: number;
  rent: number;
  serviceCharge: number;
  deposit: number;
  availabilityStatus: 'available' | 'occupied' | 'pending';
  createdAt: string;
  updatedAt: string;
};

export type ListingImageRecord = {
  id: string;
  listingId: string;
  storageKey: string;
  url: string;
  type: string;
  sortOrder: number;
  createdAt: string;
};

export type ProfileRecord = {
  id: string;
  name: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  occupation: 'student' | 'professional' | 'remote-worker' | 'entrepreneur' | 'other';
  bio: string;
  propertyDescription?: string;
  avatar: string;
  phone?: string;
  email?: string;
  role: 'tenant' | 'property-owner' | 'landlord' | 'outgoing-occupant';
  roles?: string[];
  preferences: {
    budget: { min: number; max: number };
    location: string[];
    genderPreference: 'male' | 'female' | 'any';
    ageRange: { min: number; max: number };
    moveInDate: string;
    lifestyle: string[];
    cleanliness: number;
    socialLevel: number;
    petsAllowed: boolean;
    smokingAllowed: boolean;
    propertyTypes?: string[];
  };
  verified: boolean;
  isVerified?: boolean;
};

export type RequestRecord = {
  id: string;
  fromUserId: string;
  toUserId: string;
  type: 'roommate' | 'office';
  status: 'pending' | 'accepted' | 'rejected';
  message?: string;
  createdAt: string;
  updatedAt?: string;
};

export type HousingRequestRecord = {
  id: string;
  userId: string;
  requestType: 'ROOM' | 'ROOMMATE' | 'GROUP_RENTAL';
  city: string;
  state: string;
  area: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  budgetMin: number;
  budgetMax: number;
  bedrooms?: number;
  propertyType?: string;
  furnished?: 'furnished' | 'semi-furnished' | 'unfurnished' | 'any';
  moveInDate: string;
  duration?: string;
  propertyTypes?: string[];
  lifestyle?: {
    sleepSchedule?: 'early' | 'normal' | 'late';
    noiseLevel?: number;
    guestsFrequency?: 'never' | 'rarely' | 'sometimes' | 'often';
    smokingAllowed?: boolean;
    petsAllowed?: boolean;
    genderPreference?: 'male' | 'female' | 'any';
    cleanliness?: number;
    socialLevel?: number;
  };
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
};

export type MatchRecord = {
  id: string;
  sourceUserId: string;
  targetUserId?: string | null;
  propertyId?: string | null;
  listingId?: string | null;
  housingRequestId?: string | null;
  score: number;
  status: 'PENDING' | 'VIEWED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'BLOCKED';
  reasons: string[];
  createdAt: string;
  updatedAt: string;
};
