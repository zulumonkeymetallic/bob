#!/usr/bin/env python3
"""
Deploy BOB Assistant as a Vertex AI Reasoning Engine (custom agent — no LangChain).

Creates a discoverable resource at:
  aiplatform.googleapis.com/reasoningEngines/{id}

The ServiceNow SGC for Vertex AI will find this and create a CMDB CI.

Usage:
  /tmp/bob-vertex-env/bin/python scripts/deploy_bob_reasoning_engine.py
  /tmp/bob-vertex-env/bin/python scripts/deploy_bob_reasoning_engine.py --query "top priorities?" --resource "projects/.../reasoningEngines/123"
"""

import argparse
import warnings
warnings.filterwarnings('ignore')

import vertexai
from vertexai import agent_engines

PROJECT  = 'bob20250810'
LOCATION = 'europe-west2'
STAGING  = 'gs://bob20250810-vertex-staging'

MODEL    = 'gemini-2.5-flash'

SYSTEM_INSTRUCTION = """You are BOB Assistant, Jim Donnelly's personal AI for the BOB productivity system at bob.jc1.tech.

BOB manages Jim's goals (GR-XXXXX), stories (ST-XXXXX), and tasks (TK-XXXXX).
Status codes: 0=backlog, 1=in-progress, 2=review, 4=bin.
Jim is based in Belfast (Europe/London timezone), analytical, high-ambition.

You help Jim:
- Understand his priorities and what to focus on
- Create and update stories and tasks
- Analyse his goals and progress
- Plan his day and week
- Review finance and spending

Always be concise, direct, and data-driven. Use tools to fetch live data when needed."""


# ---------------------------------------------------------------------------
# Custom Reasoning Engine — no LangChain dependency
# ---------------------------------------------------------------------------

class BobAssistantAgent:
    """BOB Assistant deployed as a Vertex AI Reasoning Engine.

    Uses the Gemini Vertex AI SDK directly with function calling.
    Compatible with Vertex AI Agent Engine runtime (set_up / query pattern).
    """

    def set_up(self):
        """Called once at cold start by the RE runtime."""
        import vertexai as _vertexai
        from vertexai.generative_models import (
            GenerativeModel,
            Tool,
            FunctionDeclaration,
        )

        _vertexai.init(project='bob20250810', location='europe-west2')

        query_bob_fn = FunctionDeclaration(
            name='query_bob',
            description=(
                'Query the BOB system for stories, tasks, goals, or priorities. '
                'Supported intents: priorities, stories, goals, daily_plan, finance.'
            ),
            parameters={
                'type': 'object',
                'properties': {
                    'intent': {
                        'type': 'string',
                        'description': "What to query — 'priorities', 'stories', 'goals', 'daily_plan', 'finance'",
                    },
                    'detail': {
                        'type': 'string',
                        'description': 'Optional filter or search term (e.g. story ref ST-12345, keyword)',
                    },
                },
                'required': ['intent'],
            },
        )

        create_story_fn = FunctionDeclaration(
            name='create_bob_story',
            description='Create a new story in the BOB system.',
            parameters={
                'type': 'object',
                'properties': {
                    'title': {
                        'type': 'string',
                        'description': 'Story title',
                    },
                    'goal_ref': {
                        'type': 'string',
                        'description': 'Parent goal reference (GR-XXXXX), optional',
                    },
                    'priority': {
                        'type': 'string',
                        'description': 'Priority: CRITICAL, HIGH, MEDIUM, or LOW',
                    },
                },
                'required': ['title'],
            },
        )

        bob_tools = Tool(function_declarations=[query_bob_fn, create_story_fn])

        self._model = GenerativeModel(
            model_name=MODEL,
            system_instruction=SYSTEM_INSTRUCTION,
            tools=[bob_tools],
        )
        self._chat = self._model.start_chat()

    def query(self, message: str) -> str:
        """Send a message and return the assistant's text response."""
        from vertexai.generative_models import Part

        response = self._chat.send_message(message)

        MAX_TURNS = 5
        for _ in range(MAX_TURNS):
            candidate = response.candidates[0]
            parts = candidate.content.parts

            # Collect function call parts — guard against proto NoneType
            fn_calls = []
            for p in parts:
                fc = getattr(p, 'function_call', None)
                if fc is not None and getattr(fc, 'name', None):
                    fn_calls.append(p)

            if not fn_calls:
                text_parts = []
                for p in parts:
                    t = getattr(p, 'text', None)
                    if t:
                        text_parts.append(t)
                return '\n'.join(text_parts) if text_parts else '(no response)'

            # Execute tools and feed results back
            tool_results = []
            for p in fn_calls:
                fc = p.function_call
                result = self._dispatch_tool(fc.name, dict(fc.args))
                tool_results.append(
                    Part.from_function_response(name=fc.name, response={'result': result})
                )

            response = self._chat.send_message(tool_results)

        last_parts = response.candidates[0].content.parts
        text_parts = [getattr(p, 'text', None) for p in last_parts]
        text_parts = [t for t in text_parts if t]
        return '\n'.join(text_parts) if text_parts else '(max tool turns reached)'

    def _dispatch_tool(self, name: str, args: dict) -> dict:
        if name == 'query_bob':
            intent = args.get('intent', 'priorities')
            detail = args.get('detail', '')
            valid = ['priorities', 'stories', 'goals', 'daily_plan', 'finance']
            if intent not in valid:
                return {'error': f"Unknown intent '{intent}'. Valid: {valid}"}
            return {
                'intent': intent,
                'detail': detail,
                'endpoint': 'https://europe-west2-bob20250810.cloudfunctions.net/sendAssistantMessageV2',
                'message': f"Live {intent} data is available via the BOB Firebase Functions endpoint.",
            }
        elif name == 'create_bob_story':
            title = args.get('title', '')
            goal_ref = args.get('goal_ref', '')
            priority = args.get('priority', 'MEDIUM')
            if priority not in ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']:
                priority = 'MEDIUM'
            return {
                'action': 'create_story',
                'title': title,
                'goalRef': goal_ref or None,
                'priority': priority,
                'endpoint': 'https://europe-west2-bob20250810.cloudfunctions.net/sendAssistantMessageV2',
                'message': f"Story '{title}' creation routed to BOB Firebase Functions.",
            }
        return {'error': f"Unknown tool: {name}"}


# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------

def deploy():
    print(f"Initialising Vertex AI — project={PROJECT}, location={LOCATION}")
    vertexai.init(project=PROJECT, location=LOCATION, staging_bucket=STAGING)

    print("Creating Reasoning Engine (custom agent — no LangChain)...")
    engine = agent_engines.create(
        BobAssistantAgent(),
        requirements=[
            'google-cloud-aiplatform[reasoningengine]>=1.70',
        ],
        display_name='BOB Assistant',
        description=(
            'BOB personal productivity assistant powered by Gemini. '
            'Manages stories, tasks, goals and priorities for Jim Donnelly. '
            'Deployed for CMDB visibility via ServiceNow SGC Vertex AI connector.'
        ),
    )

    print(f"\n  Reasoning Engine deployed")
    print(f"   Resource : {engine.resource_name}")
    print(f"   Project  : {PROJECT}")
    print(f"   Location : {LOCATION}")
    print(f"\n  Save the resource name:")
    print(f"   {engine.resource_name}")
    print(f"\n  SGC endpoint:")
    print(f"   https://{LOCATION}-aiplatform.googleapis.com/v1/{engine.resource_name}")

    return engine


# ---------------------------------------------------------------------------
# Query an existing engine
# ---------------------------------------------------------------------------

def query_engine(resource_name: str, query: str):
    vertexai.init(project=PROJECT, location=LOCATION)
    engine = agent_engines.get(resource_name)
    result = engine.query(message=query)
    print(result)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--query', help='Test query against an existing engine')
    parser.add_argument('--resource', help='Full resource name for --query')
    args = parser.parse_args()

    if args.query:
        if not args.resource:
            print("--resource required with --query")
        else:
            query_engine(args.resource, args.query)
    else:
        deploy()
