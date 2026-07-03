#!/usr/bin/env python3
"""
Deploy BOB Hermes skills as Vertex AI Reasoning Engines.

Each skill becomes a discoverable CMDB CI via the ServiceNow SGC Vertex AI connector.
Also creates a Tensorboard for experiment/run tracking.

Usage:
  /tmp/bob-vertex-env/bin/python scripts/deploy_bob_skill_engines.py
  /tmp/bob-vertex-env/bin/python scripts/deploy_bob_skill_engines.py --list
  /tmp/bob-vertex-env/bin/python scripts/deploy_bob_skill_engines.py --delete-all
"""

import argparse
import warnings
warnings.filterwarnings('ignore')

import vertexai
from vertexai import agent_engines
from google.cloud import aiplatform

PROJECT  = 'bob20250810'
LOCATION = 'europe-west2'
STAGING  = 'gs://bob20250810-vertex-staging'

REQUIREMENTS = ['google-cloud-aiplatform[reasoningengine]>=1.70']

# ---------------------------------------------------------------------------
# Skill definitions — each maps to a Hermes skill
# ---------------------------------------------------------------------------

SKILL_ENGINES = [
    {
        'name': 'delegation',
        'display_name': 'BOB AI Delegation Pipeline',
        'description': (
            'Processes AI-delegated stories and tasks in the BOB productivity system. '
            'Picks up items flagged for AI handling, executes research and planning work, '
            'and archives outputs back to Firestore. Maps to bob-ai-delegation Hermes skill.'
        ),
        'tools': ['execute_delegation', 'get_flagged_items', 'complete_delegation'],
        'system': (
            'You are BOB Delegation Pipeline, an AI agent that picks up stories and tasks '
            'Jim has flagged for AI handling in the BOB system at bob.jc1.tech. '
            'You execute research, planning, and drafting work, then archive results back to BOB. '
            'Stories use refs like ST-XXXXX. Tasks use TK-XXXXX. '
            'Status codes: 0=backlog, 1=in-progress, 2=review, 4=bin. '
            'Always set status=2 (Review) after completing delegated work — Jim closes to Done.'
        ),
    },
    {
        'name': 'daily_planner',
        'display_name': 'BOB Daily Planner',
        'description': (
            'Generates Jim\'s structured daily plan combining BOB priorities, health readiness, '
            'and calendar blocks. Produces top-3 tasks, training block, and key commitments. '
            'Maps to bob-daily-plan-generator Hermes skill.'
        ),
        'tools': ['generate_daily_plan', 'get_health_status', 'get_calendar_blocks'],
        'system': (
            'You are BOB Daily Planner, an AI agent that generates Jim Donnelly\'s daily plan. '
            'Jim is based in Belfast (Europe/London). He follows Ironman triathlon training. '
            'You combine his BOB task priorities, health readiness data, and calendar blocks '
            'to produce a structured daily plan with top-3 focus items and training schedule. '
            'Be concise, direct, and realistic about what fits in a day.'
        ),
    },
    {
        'name': 'finance_analyst',
        'display_name': 'BOB Finance Analyst',
        'description': (
            'Analyses Monzo transactions, budget pots, and spending patterns for Jim Donnelly. '
            'Produces spending summaries, budget tracking, anomaly detection, and financial insights. '
            'Maps to bob-finance-analysis Hermes skill.'
        ),
        'tools': ['analyse_spending', 'get_budget_summary', 'detect_anomalies'],
        'system': (
            'You are BOB Finance Analyst, an AI agent that analyses Jim\'s Monzo banking data. '
            'You have access to 30 days of transactions, budget summaries, and pot balances. '
            'Jim targets debt reduction and savings growth. Currency is GBP. '
            'Surface actionable insights: overspend categories, unusual transactions, '
            'progress against budget. Be specific with amounts and percentages.'
        ),
    },
    {
        'name': 'knowledge_graph',
        'display_name': 'BOB Hindsight Knowledge Graph',
        'description': (
            'Manages and queries Jim\'s personal knowledge graph built from AI session memories. '
            'Entities include people, projects, decisions, and concepts extracted from '
            'Claude Code and Hermes sessions. Maps to hindsight-graph Hermes skill.'
        ),
        'tools': ['query_knowledge_graph', 'find_related_entities', 'get_entity_connections'],
        'system': (
            'You are BOB Hindsight Knowledge Graph agent, managing Jim\'s personal memory bank. '
            'The knowledge graph contains entities (people, projects, decisions, concepts) '
            'extracted from AI sessions and cross-linked by co-occurrence and semantic similarity. '
            'Help Jim recall past decisions, find connections between projects, and surface '
            'relevant context from historical sessions.'
        ),
    },
    {
        'name': 'travel_agent',
        'display_name': 'BOB Travel Agent',
        'description': (
            'Plans travel for Jim Donnelly — flights, hotels, itineraries, and budget estimates. '
            'Specialises in Ironman triathlon-compatible travel with training schedule awareness. '
            'Maps to bob-travel-agent-pipeline Hermes skill.'
        ),
        'tools': ['research_flights', 'research_hotels', 'build_itinerary', 'estimate_budget'],
        'system': (
            'You are BOB Travel Agent, planning travel for Jim Donnelly based in Belfast. '
            'Jim is an Ironman triathlete — factor in training compatibility, swim/bike/run access. '
            'He follows a 1400 cal/day diet (Wegovy). '
            'Priorities: training continuity, budget efficiency, direct routes where possible. '
            'Currency GBP. Always provide specific options with prices and trade-offs.'
        ),
    },
    {
        'name': 'sprint_manager',
        'display_name': 'BOB Sprint Manager',
        'description': (
            'Manages BOB sprint planning — sets in-progress stories, moves others to backlog, '
            'creates missing priority stories, and links them to goals. '
            'Maps to bob-sprint-refresher Hermes skill.'
        ),
        'tools': ['refresh_sprint', 'set_story_status', 'create_priority_story'],
        'system': (
            'You are BOB Sprint Manager, handling sprint planning for Jim\'s BOB system. '
            'You move specified stories to in-progress and push everything else to backlog. '
            'Jim works in 2-week sprints. Stories reference goals (GR-XXXXX). '
            'Status: 0=backlog, 1=in-progress, 2=review, 4=bin. '
            'Always confirm changes before writing — show what will move in/out of sprint.'
        ),
    },
]


# ---------------------------------------------------------------------------
# Generic custom agent — same pattern as main BOB Assistant (no LangChain)
# ---------------------------------------------------------------------------

class BobSkillAgent:
    """Generic Vertex AI Reasoning Engine for a BOB Hermes skill."""

    def __init__(self, skill_name: str, system_instruction: str, tool_names: list):
        self._skill_name = skill_name
        self._system_instruction = system_instruction
        self._tool_names = tool_names
        self._model = None
        self._chat = None

    def set_up(self):
        import vertexai as _vertexai
        from vertexai.generative_models import GenerativeModel, Tool, FunctionDeclaration

        _vertexai.init(project='bob20250810', location='europe-west2')

        # Build function declarations from tool names
        declarations = []
        for tool_name in self._tool_names:
            declarations.append(FunctionDeclaration(
                name=tool_name,
                description=f'Execute the {tool_name} capability of the {self._skill_name} skill.',
                parameters={
                    'type': 'object',
                    'properties': {
                        'query': {
                            'type': 'string',
                            'description': 'The request or query to process',
                        },
                        'context': {
                            'type': 'string',
                            'description': 'Additional context or parameters (JSON string or plain text)',
                        },
                    },
                    'required': ['query'],
                },
            ))

        tool = Tool(function_declarations=declarations)

        self._model = GenerativeModel(
            model_name='gemini-2.5-flash',
            system_instruction=self._system_instruction,
            tools=[tool],
        )
        self._chat = self._model.start_chat()

    def query(self, message: str) -> str:
        from vertexai.generative_models import Part

        response = self._chat.send_message(message)

        MAX_TURNS = 5
        for _ in range(MAX_TURNS):
            candidate = response.candidates[0]
            parts = candidate.content.parts

            fn_calls = []
            for p in parts:
                fc = getattr(p, 'function_call', None)
                if fc is not None and getattr(fc, 'name', None):
                    fn_calls.append(p)

            if not fn_calls:
                text_parts = [getattr(p, 'text', None) for p in parts]
                text_parts = [t for t in text_parts if t]
                return '\n'.join(text_parts) if text_parts else '(no response)'

            tool_results = []
            for p in fn_calls:
                fc = p.function_call
                result = {
                    'skill': self._skill_name,
                    'tool': fc.name,
                    'endpoint': 'https://europe-west2-bob20250810.cloudfunctions.net/sendAssistantMessageV2',
                    'message': f'Routed to BOB Firebase Functions for live data.',
                }
                tool_results.append(
                    Part.from_function_response(name=fc.name, response={'result': result})
                )

            response = self._chat.send_message(tool_results)

        last_parts = response.candidates[0].content.parts
        text_parts = [getattr(p, 'text', None) for p in last_parts]
        return '\n'.join(t for t in text_parts if t) or '(max tool turns reached)'


# ---------------------------------------------------------------------------
# Deploy all skill engines
# ---------------------------------------------------------------------------

def deploy_all():
    vertexai.init(project=PROJECT, location=LOCATION, staging_bucket=STAGING)

    deployed = []
    for spec in SKILL_ENGINES:
        print(f"\nDeploying: {spec['display_name']} ...")
        try:
            agent = BobSkillAgent(
                skill_name=spec['name'],
                system_instruction=spec['system'],
                tool_names=spec['tools'],
            )
            engine = agent_engines.create(
                agent,
                requirements=REQUIREMENTS,
                display_name=spec['display_name'],
                description=spec['description'],
            )
            deployed.append({'name': spec['display_name'], 'resource': engine.resource_name})
            print(f"  OK  {engine.resource_name}")
        except Exception as e:
            print(f"  FAILED: {e}")

    print(f"\n{'='*60}")
    print(f"Deployed {len(deployed)}/{len(SKILL_ENGINES)} skill engines:")
    for d in deployed:
        print(f"  {d['name']}")
        print(f"    {d['resource']}")

    return deployed


def create_tensorboard():
    """Create a Tensorboard instance for BOB experiment tracking."""
    aiplatform.init(project=PROJECT, location=LOCATION)
    tb = aiplatform.Tensorboard.create(
        display_name='BOB AI Experiments',
        description=(
            'Tracks AI skill executions, delegation outcomes, and model performance '
            'across BOB Firebase Functions and Hermes agent pipelines.'
        ),
        project=PROJECT,
        location=LOCATION,
    )
    print(f"\n  Tensorboard created: {tb.resource_name}")
    return tb


def list_engines():
    vertexai.init(project=PROJECT, location=LOCATION)
    print("Reasoning Engines in bob20250810 / europe-west2:")
    for e in agent_engines.list():
        print(f"  {e.display_name}")
        print(f"    {e.resource_name}")


def delete_all():
    vertexai.init(project=PROJECT, location=LOCATION)
    engines = list(agent_engines.list())
    print(f"Deleting {len(engines)} engines...")
    for e in engines:
        try:
            e.delete(force=True)
            print(f"  Deleted: {e.display_name}")
        except Exception as ex:
            print(f"  Failed {e.display_name}: {ex}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--list', action='store_true', help='List existing engines')
    parser.add_argument('--delete-all', action='store_true', help='Delete all engines')
    parser.add_argument('--tensorboard', action='store_true', help='Create Tensorboard only')
    args = parser.parse_args()

    if args.list:
        list_engines()
    elif args.delete_all:
        delete_all()
    elif args.tensorboard:
        create_tensorboard()
    else:
        print("=== BOB Skill Engines — Vertex AI Deployment ===")
        print(f"Project : {PROJECT}")
        print(f"Location: {LOCATION}")
        print(f"Skills  : {len(SKILL_ENGINES)}")

        deploy_all()

        print("\n=== Creating Tensorboard for experiment tracking ===")
        try:
            create_tensorboard()
        except Exception as e:
            print(f"  Tensorboard failed (non-critical): {e}")

        print("\nDone. All resources discoverable by ServiceNow SGC Vertex AI connector.")
