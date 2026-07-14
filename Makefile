SHELL := /usr/bin/zsh

ENV ?= gate
PORT ?= /dev/ttyACM0
BAUD ?= 115200
BUSID ?=
WSL_DISTRO ?= Ubuntu-24.04
USB_MATCH ?= Espressif|USB JTAG|CDC ACM
PIO_PROJECT_DIR := firmware
PLATFORMIO_CORE_DIR ?= $(CURDIR)/firmware/.platformio-core
PIO := PLATFORMIO_CORE_DIR=$(PLATFORMIO_CORE_DIR) pio

.PHONY: help pio-info embed-ui build upload monitor upload-monitor clean size devices check test test-device test-device-destructive attach-usb reattach-upload erase-flash

help:
	@echo "MTB Gate - Unified firmware (role and peer MAC configurable via web UI)"
	@echo ""
	@echo "  make build           Build unified gate firmware"
	@echo "  make upload          Flash to /dev/ttyACM0 and /dev/ttyACM1 (both devices)"
	@echo "  make upload-monitor  Flash, then open serial monitor"
	@echo "  make monitor         Open serial monitor on PORT=$(PORT)"
	@echo "  make reattach-upload Attach USB to WSL, then flash"
	@echo "  make attach-usb      Attach ESP32 USB device to WSL with usbipd.exe"
	@echo "  make erase-flash     Erase flash (required after partition table change)"
	@echo "  make clean           Remove PlatformIO build output"
	@echo "  make size            Print firmware memory usage"
	@echo "  make devices         List connected serial devices"
	@echo "  make pio-info        Show PlatformIO system info"
	@echo "  make check           Run repo tests and firmware build"
	@echo "  make test            Run Node-based tests"
	@echo "  make test-device     Run serial console API tests on /dev/ttyACM0 and /dev/ttyACM1"
	@echo "  make test-device-destructive Run opt-in destructive topology tests"
	@echo ""
	@echo "After flashing both devices:"
	@echo "  1. Connect to each device's AP (Gate-<#>-<mac>, password changeme123)"
	@echo "  2. Visit http://192.168.4.<gateNumber>/"
	@echo "  3. Set gate number on Gate Config page (1=Start, 12=Finish)"
	@echo "  4. Set peer MAC (or leave empty for auto-discovery)"
	@echo ""
	@echo "Usage: make build && make upload"
	@echo "       (or) make upload PORT=/dev/ttyACM0  # single device"

attach-usb:
	@BUSID_VALUE="$(BUSID)"; \
	if [[ -z "$$BUSID_VALUE" ]]; then \
		BUSID_VALUE="$$(usbipd.exe list | tr -d '\r' | grep -m1 -E '$(USB_MATCH)' | awk '{print $$1}')"; \
	fi; \
	if [[ -z "$$BUSID_VALUE" ]]; then \
		echo "No matching USB device found in usbipd.exe list. Reconnect the ESP32 or pass BUSID=..."; \
		exit 1; \
	fi; \
	echo "Attaching USB device $$BUSID_VALUE to WSL distro $(WSL_DISTRO)..."; \
	ATTACH_OUTPUT="$$(usbipd.exe attach --wsl "$(WSL_DISTRO)" --busid "$$BUSID_VALUE" 2>&1)"; \
	ATTACH_STATUS="$$?"; \
	echo "$$ATTACH_OUTPUT"; \
	if [[ "$$ATTACH_STATUS" -eq 0 ]]; then \
		exit 0; \
	fi; \
	if echo "$$ATTACH_OUTPUT" | grep -qi "already attached"; then \
		echo "USB device $$BUSID_VALUE is already attached to WSL; continuing."; \
		exit 0; \
	fi; \
	exit "$$ATTACH_STATUS"

erase-flash:
	@ESPTOOL=$(PIO_PROJECT_DIR)/.platformio-core/packages/tool-esptoolpy/esptool.py; \
	if [[ "$(PORT)" == "/dev/ttyACM0" ]]; then \
		echo "Erasing flash on /dev/ttyACM0 and /dev/ttyACM1..."; \
		python3 "$$ESPTOOL" -p /dev/ttyACM0 erase_flash; \
		sleep 2; \
		python3 "$$ESPTOOL" -p /dev/ttyACM1 erase_flash; \
	else \
		python3 "$$ESPTOOL" -p $(PORT) erase_flash; \
	fi

pio-info:
	@$(PIO) system info

embed-ui:
	@npm run embed:device-ui

build: embed-ui
	@$(PIO) run --project-dir $(PIO_PROJECT_DIR) --environment $(ENV)

upload: embed-ui
	@if [[ "$(PORT)" == "/dev/ttyACM0" ]]; then \
		echo "Uploading to /dev/ttyACM0 and /dev/ttyACM1..."; \
		$(PIO) run --project-dir $(PIO_PROJECT_DIR) --environment $(ENV) --target upload --upload-port /dev/ttyACM0; \
		echo "Waiting 3 seconds before flashing second device..."; \
		sleep 3; \
		$(PIO) run --project-dir $(PIO_PROJECT_DIR) --environment $(ENV) --target upload --upload-port /dev/ttyACM1; \
	else \
		$(PIO) run --project-dir $(PIO_PROJECT_DIR) --environment $(ENV) --target upload --upload-port $(PORT); \
	fi

reattach-upload: attach-usb upload

monitor:
	@$(PIO) device monitor --project-dir $(PIO_PROJECT_DIR) --environment $(ENV) --port $(PORT) --baud $(BAUD)

upload-monitor:
	@$(PIO) run --project-dir $(PIO_PROJECT_DIR) --environment $(ENV) --target upload --target monitor --upload-port $(PORT) --monitor-port $(PORT)

clean:
	@$(PIO) run --project-dir $(PIO_PROJECT_DIR) --environment $(ENV) --target clean

size:
	@$(PIO) run --project-dir $(PIO_PROJECT_DIR) --environment $(ENV) --target size

devices:
	@$(PIO) device list

test:
	@npm test

test-device:
	@npm run test:device

test-device-destructive:
	@npm run test:device:destructive

check: test
	@$(MAKE) build
