import React from 'react';
import { Container, Row, Col, Card } from 'react-bootstrap';
import ModernSprintsTable from '../ModernSprintsTable';

const SprintTablePage: React.FC = () => {
  return (
    <Container fluid className="px-4 py-3">
      <Row>
        <Col>
          <Card>
            <Card.Header>
              <h5 className="mb-0">Sprints (Table)</h5>
            </Card.Header>
            <Card.Body>
              <ModernSprintsTable />
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default SprintTablePage;

