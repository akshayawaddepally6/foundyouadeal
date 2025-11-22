"""
Configuration file for Llama 3.1 fine-tuning on product pricing data.
"""

from datetime import datetime

# ===== Model Configuration =====
BASE_MODEL = "meta-llama/Meta-Llama-3.1-8B"
PROJECT_NAME = "dealytics"
HF_USER = "akshayawadd"  # Replace with your HuggingFace username

# ===== Dataset Configuration =====
DATASET_NAME = f"{HF_USER}/dealytics-data"
MAX_SEQUENCE_LENGTH = 182

# ===== Run Naming =====
RUN_NAME = f"{datetime.now():%Y-%m-%d_%H.%M.%S}"
PROJECT_RUN_NAME = f"{PROJECT_NAME}-{RUN_NAME}"
HUB_MODEL_NAME = f"{HF_USER}/{PROJECT_RUN_NAME}"

# ===== QLoRA Fine-tuning Parameters =====
LORA_R = 32
LORA_ALPHA = 64
TARGET_MODULES = ["q_proj", "v_proj", "k_proj", "o_proj"]
LORA_DROPOUT = 0.1
QUANT_4_BIT = True

# ===== Training Hyperparameters =====
EPOCHS = 1  # One full pass is usually enough
BATCH_SIZE = 4  # Increase if GPU has more memory
GRADIENT_ACCUMULATION_STEPS = 1
LEARNING_RATE = 1e-4
LR_SCHEDULER_TYPE = "cosine"
WARMUP_RATIO = 0.03
OPTIMIZER = "paged_adamw_32bit"

# ===== Logging & Checkpointing =====
STEPS = 50  # Progress log frequency
SAVE_STEPS = 2000  # Hub checkpoint upload frequency
LOG_TO_WANDB = True  # Enable Weights & Biases logging

# ===== Testing Configuration =====
TOP_K = 3  # Number of top tokens to consider for price prediction
TEST_SAMPLES = 250  # Number of samples to evaluate
