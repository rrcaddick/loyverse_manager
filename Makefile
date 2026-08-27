# Convenience wrappers around docker compose.
# Everything here is optional - the plain compose commands work just as well.

COMPOSE := docker compose

.DEFAULT_GOAL := help
.PHONY: help build up down restart logs ps migrate shell db-shell \
        add-inventory clear-inventory hide-quicket-event

help: ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: ## Build the application image
	$(COMPOSE) build

up: ## Start the whole stack in the background
	$(COMPOSE) up -d --build

down: ## Stop the stack (database volume is kept)
	$(COMPOSE) down

restart: ## Recreate the app containers
	$(COMPOSE) up -d --build --force-recreate web scheduler

logs: ## Follow logs for every service
	$(COMPOSE) logs -f

ps: ## Show container status
	$(COMPOSE) ps

migrate: ## Apply pending database migrations
	$(COMPOSE) run --rm migrate

shell: ## Shell inside a throwaway app container
	$(COMPOSE) run --rm web bash

db-shell: ## MySQL prompt on the database container
	$(COMPOSE) exec db sh -c 'mysql -u"$$MYSQL_USER" -p"$$MYSQL_PASSWORD" "$$MYSQL_DATABASE"'

add-inventory: ## Run the morning Quicket/groups sync now
	$(COMPOSE) run --rm scheduler add-inventory

clear-inventory: ## Run the end-of-day teardown now
	$(COMPOSE) run --rm scheduler clear-inventory

hide-quicket-event: ## Hide today's Quicket event now
	$(COMPOSE) run --rm scheduler hide-quicket-event
