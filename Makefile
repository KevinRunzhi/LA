SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

PYTHON ?= python3
VENV := backend/.venv
VENV_PYTHON := $(VENV)/bin/python
VENV_GUNICORN := $(VENV)/bin/gunicorn
APP_PORT ?= 8080

.PHONY: help install install-backend install-frontend build test test-backend \
	check check-python check-shell preflight run backup integrity ingestion-once case-validate generation-once clean-runtime

help:
	@printf '%s\n' \
	  'LA industrial case platform commands:' \
	  '  make install       Install locked Python and Node dependencies' \
	  '  make build         Build the React production bundle' \
	  '  make test          Run all backend tests' \
	  '  make check         Compile Python, test shell, run tests and build' \
	  '  make preflight     Validate deploy configuration and runtime assets' \
	  '  make run           Start the production WSGI service with Gunicorn' \
	  '  make backup        Create an integrity-checked SQLite backup' \
	  '  make integrity     Run database and runtime asset integrity checks' \
	  '  make ingestion-once Process one pending manual ingestion item' \
	  '  make case-validate DRAFT=<id> Validate one governed case draft' \
	  '  make generation-once Process one multi-agent generation stage'

install: install-backend install-frontend

$(VENV_PYTHON):
	$(PYTHON) -m venv $(VENV)

install-backend: $(VENV_PYTHON)
	$(VENV_PYTHON) -m pip install --disable-pip-version-check -r backend/requirements.txt

install-frontend:
	npm --prefix frontend ci

build:
	npm --prefix frontend run build

test: test-backend

test-backend:
	$(VENV_PYTHON) -m unittest discover -s backend -p 'test*.py' -v

check-python:
	$(VENV_PYTHON) -m compileall -q backend

check-shell:
	@find scripts deploy -type f -name '*.sh' -print0 | \
	  xargs -0 -n1 bash -n
	$(VENV_PYTHON) -m py_compile deploy/gunicorn.conf.py

preflight:
	LA_ENV=production \
	PRESENTATION_DATABASE_PATH=run/preflight/presentation.db \
	ATTACHMENT_STORAGE_ROOT=run/preflight/attachments \
	LA_MANUAL_STORAGE_ROOT=run/preflight/manuals \
	LA_JOB_CARD_STORAGE_ROOT=run/preflight/job-cards \
	$(VENV_PYTHON) -m backend.runtime.preflight

check: check-python check-shell test-backend build preflight

run:
	LA_ENV=production APP_PORT=$(APP_PORT) \
	  $(VENV_GUNICORN) --config deploy/gunicorn.conf.py backend.wsgi:application

backup:
	bash deploy/loongarch/scripts/backup.sh

integrity:
	$(VENV_PYTHON) -m backend.operations_cli integrity

ingestion-once:
	$(VENV_PYTHON) -m backend.ingestion_worker --once

case-validate:
	@test -n "$(DRAFT)" || (echo 'DRAFT is required' >&2; exit 2)
	$(VENV_PYTHON) -m backend.case_authoring_cli validate "$(DRAFT)"

generation-once:
	$(VENV_PYTHON) -m backend.case_generation_worker --once

clean-runtime:
	@printf 'Runtime cleanup is intentionally not automatic. Review run/ manually.\n'
