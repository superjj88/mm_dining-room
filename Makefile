.PHONY: up down devcontainer-setup bench bench-start logs sh migrate pos-dev signage-dev web-dev admin-dev

up:
	docker compose -f .devcontainer/docker-compose.yml up -d

down:
	docker compose -f .devcontainer/docker-compose.yml down

devcontainer-setup: up
	@echo "Waiting for services to start..."
	@sleep 5
	docker exec -it $$(docker compose -f .devcontainer/docker-compose.yml ps -q frappe) bash scripts/setup.sh

sh:
	docker exec -it $$(docker compose -f .devcontainer/docker-compose.yml ps -q frappe) bash

bench:
	docker exec -it $$(docker compose -f .devcontainer/docker-compose.yml ps -q frappe) bash

logs:
	docker compose -f .devcontainer/docker-compose.yml logs -f

bench-start:
	docker exec $$(docker compose -f .devcontainer/docker-compose.yml ps -q frappe) bench start

# Frontend dev servers (run from host, not container)
pos-dev:
	cd frontend/pos && npm install && npm run dev

signage-dev:
	cd frontend/signage && npm install && npm run dev

web-dev:
	cd frontend/public_web && npm install && npm run dev

admin-dev:
	cd frontend/admin && npm install && npm run dev
