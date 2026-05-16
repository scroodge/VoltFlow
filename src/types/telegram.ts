export type KnowledgeArticle = {
  id: string;
  slug: string;
  title: string;
  category: string;
  categorySlug: string;
  tags: string[];
  summary: string;
  sections: {
    heading: string;
    body: string;
  }[];
  tips?: string[];
  warnings?: string[];
  relatedIds?: string[];
  updatedAt?: string;
  sourceLabel?: string;
};

export type FAQItem = {
  id: string;
  question: string;
  answer: string;
  category: string;
  categorySlug: string;
  tags: string[];
  relatedIds?: string[];
};

export type AccessoryPriority = "must-have" | "useful" | "optional";

export type AccessoryItem = {
  id: string;
  title: string;
  category: string;
  categorySlug: string;
  useCase: string;
  whyUseful: string;
  whatToCheckBeforeBuying: string[];
  priority: AccessoryPriority;
  riskNotes?: string[];
  searchKeywords: string[];
  externalUrl?: string;
  imageUrl?: string;
  imageAlt?: string;
};
