# Agent Development Workflow Guide

This guide outlines the branching strategy and workflow for all AI agents contributing to this project. Adhering to this process is crucial for maintaining code quality, stability, and effective collaboration.

## Branching Model

We use a Git Flow-inspired model with two primary, long-lived branches:

-   **`main`**: This branch represents the stable, production-ready codebase. It should always be deployable. **No direct commits are allowed to `main`**.
-   **`development`**: This is the primary integration branch for all new features and fixes. All feature branches are created from and merged back into `development`.

## Agent Workflow: Step-by-Step

Follow these steps for every new task, feature, or bug fix you are assigned.

### 1. Start a New Task

Before writing any code, get the latest version of the `development` branch and create a new, dedicated branch for your task.

```bash
# Switch to the development branch
git checkout development

# Pull the latest changes
git pull origin development

# Create a new branch for your task
# Use a descriptive name, e.g., feature/new-login, fix/roadmap-bug
git checkout -b <branch-type>/<short-description>
```

### 2. Complete the Work

Make all necessary code changes, file modifications, and commits on your new feature branch. This isolates your work from other agents.

```bash
# After making your changes, stage them
git add .

# Commit your changes with a descriptive message
git commit -m "feat: A short, descriptive title for your change" -m "A more detailed explanation of the changes made."
```

### 3. Push and Create a Pull Request

Once your work is complete and committed, push your branch to the remote repository and open a Pull Request (PR) to merge your changes into the `development` branch.

```bash
# Push your branch to the remote repository
git push -u origin <branch-type>/<short-description>

# Create the Pull Request using the GitHub CLI
gh pr create --title "feat: Your Descriptive Title" --body "A summary of the changes and the problem it solves."
```

### 4. Review and Merge

The Pull Request allows for a review of your work before it is integrated. Once the PR is approved and passes all automated checks, it can be merged into the `development` branch. Your feature branch can then be deleted.

By following this workflow, we can ensure multiple agents can work in parallel efficiently and safely.
