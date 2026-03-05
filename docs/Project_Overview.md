# <p style="text-align: center;">Project Overview </p>

## Description

RedCore is an AI-assisted, rule-based PC builder that allows users to describe the PC they want and automatically generate a compatible desktop PC configuration.

Instead of manually selecting every component, the system analyzes the user’s request and chooses hardware parts that work together.


## Why this project

Many users want to build their own PC, but they often run into problems. Some people end up buying overpriced components, while others purchase parts that are not compatible with each other. In many cases, users simply choose a prebuilt PC even if it is not the best option for their needs.

RedCore was created to simplify this process by automatically generating a compatible PC build based on the user’s requirements.

## How the system works 

The user describes the PC they want using normal language.
An AI model analyzes the request and extracts important information such as the budget and purpose of the build.

After that, a rule-based engine selects compatible hardware components from the hardware database and generates a complete PC build configuration.

## Technologies used 

Frontend: Farmer 
Backend API: Cloudflare Workers
AI Model: HuggingFace (Qwen) 
Hardware Database: JSON dataset
Development Tools: Visual Studio Code 
Automation Prototype: Make.com
Database Prototype: Airtable

## Current Project Status 

This project is currently still in development 
Future versions will expand the hardware database and improve the rule engine to support more build types and hardware compatibility scenarios.

The AI extraction system and rule engine are partially functional, and the frontend prototype is partially completed.
