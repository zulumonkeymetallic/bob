import React from 'react';
import { Button, Container } from 'react-bootstrap';
import { BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';

import JournalInsightsCard from './JournalInsightsCard';
import PageHeader from './common/PageHeader';

const JournalInsightsPage: React.FC = () => (
  <Container fluid className="py-4">
    <PageHeader
      title="Journal Insights"
      subtitle="Detailed mood, stress, energy, sentiment, and theme analysis from processed journal entries."
      breadcrumbs={[
        { label: 'Journals', href: '/journals' },
        { label: 'Insights' },
      ]}
      actions={(
        <Button as={Link as any} to="/journals" variant="outline-secondary">
          <BookOpen size={16} className="me-2" />
          Journal entries
        </Button>
      )}
    />
    <JournalInsightsCard showHeader={false} />
  </Container>
);

export default JournalInsightsPage;
