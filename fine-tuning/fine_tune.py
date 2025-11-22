"""
Fine-tune Llama 3.1 8B on product pricing data using QLoRA.

This script trains the model to predict product prices based on descriptions.
It uses 4-bit quantization with LoRA adapters for efficient fine-tuning.
"""

import os
import torch
from huggingface_hub import login
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    set_seed,
    BitsAndBytesConfig
)
from datasets import load_dataset
import wandb
from peft import LoraConfig
from trl import SFTTrainer, SFTConfig, DataCollatorForCompletionOnlyLM

from config import *


def setup_authentication(hf_token, wandb_key=None):
    """Authenticate with HuggingFace and Weights & Biases."""
    print("🔑 Authenticating with HuggingFace...")
    login(token=hf_token, add_to_git_credential=True)

    if wandb_key and LOG_TO_WANDB:
        print("🔑 Authenticating with Weights & Biases...")
        os.environ["WANDB_API_KEY"] = wandb_key
        wandb.login()
        os.environ["WANDB_PROJECT"] = PROJECT_NAME
        os.environ["WANDB_LOG_MODEL"] = "checkpoint"
        os.environ["WANDB_WATCH"] = "gradients"


def load_training_data():
    """Load the dealytics dataset from HuggingFace Hub."""
    print(f"📊 Loading dataset: {DATASET_NAME}")
    dataset = load_dataset(DATASET_NAME)

    train = dataset["train"]
    test = dataset["test"]

    print(f"✓ Training samples: {len(train):,}")
    print(f"✓ Test samples: {len(test):,}")
    print(f"\n📝 Sample data:")
    print(f"   Text preview: {train[0]['text'][:100]}...")
    print(f"   Price: ${train[0]['price']:.2f}")

    return train, test


def setup_quantization():
    """Configure 4-bit quantization for efficient training."""
    if QUANT_4_BIT:
        print("⚙️  Configuring 4-bit quantization (NF4)...")
        quant_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_quant_type="nf4"
        )
    else:
        print("⚙️  Configuring 8-bit quantization...")
        quant_config = BitsAndBytesConfig(
            load_in_8bit=True,
            bnb_8bit_compute_dtype=torch.bfloat16
        )

    return quant_config


def load_base_model(quant_config):
    """Load the base Llama 3.1 model with quantization."""
    print(f"🦙 Loading base model: {BASE_MODEL}")

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    # Load model with quantization
    base_model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=quant_config,
        device_map="auto",
    )

    base_model.generation_config.pad_token_id = tokenizer.pad_token_id

    memory_mb = base_model.get_memory_footprint() / 1e6
    print(f"✓ Model loaded: {memory_mb:.1f} MB")

    return base_model, tokenizer


def create_data_collator(tokenizer):
    """
    Create a data collator that trains the model to predict only the price,
    not the entire product description.
    """
    price_prefix = "Price is $"
    collator = DataCollatorForCompletionOnlyLM(
        response_template=price_prefix,
        tokenizer=tokenizer
    )
    return collator


def configure_lora():
    """Configure LoRA parameters for efficient fine-tuning."""
    print("🔧 Configuring LoRA...")
    print(f"   - Rank (r): {LORA_R}")
    print(f"   - Alpha: {LORA_ALPHA}")
    print(f"   - Dropout: {LORA_DROPOUT}")
    print(f"   - Target modules: {TARGET_MODULES}")

    lora_config = LoraConfig(
        r=LORA_R,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=TARGET_MODULES,
    )

    return lora_config


def configure_training():
    """Configure training hyperparameters."""
    print("🎯 Configuring training...")
    print(f"   - Epochs: {EPOCHS}")
    print(f"   - Batch size: {BATCH_SIZE}")
    print(f"   - Learning rate: {LEARNING_RATE}")
    print(f"   - Optimizer: {OPTIMIZER}")
    print(f"   - Model will be saved to: {HUB_MODEL_NAME}")

    training_config = SFTConfig(
        output_dir=PROJECT_RUN_NAME,
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        per_device_eval_batch_size=1,
        eval_strategy="no",
        gradient_accumulation_steps=GRADIENT_ACCUMULATION_STEPS,
        optim=OPTIMIZER,
        save_steps=SAVE_STEPS,
        save_total_limit=10,
        logging_steps=STEPS,
        learning_rate=LEARNING_RATE,
        weight_decay=0.001,
        fp16=False,
        bf16=True,
        max_grad_norm=0.3,
        max_steps=-1,
        warmup_ratio=WARMUP_RATIO,
        group_by_length=True,
        lr_scheduler_type=LR_SCHEDULER_TYPE,
        report_to="wandb" if LOG_TO_WANDB else None,
        run_name=RUN_NAME,
        max_seq_length=MAX_SEQUENCE_LENGTH,
        dataset_text_field="text",
        save_strategy="steps",
        hub_strategy="every_save",
        push_to_hub=True,
        hub_model_id=HUB_MODEL_NAME,
        hub_private_repo=True
    )

    return training_config


def main(hf_token, wandb_key=None):
    """Main training function."""
    print("=" * 60)
    print("🚀 Starting Llama 3.1 Fine-Tuning for Product Pricing")
    print("=" * 60)

    # Setup
    setup_authentication(hf_token, wandb_key)

    # Load data
    train_data, test_data = load_training_data()

    # Initialize W&B
    if LOG_TO_WANDB:
        print(f"📈 Starting W&B run: {RUN_NAME}")
        wandb.init(project=PROJECT_NAME, name=RUN_NAME)

    # Setup model
    quant_config = setup_quantization()
    base_model, tokenizer = load_base_model(quant_config)

    # Setup training
    collator = create_data_collator(tokenizer)
    lora_config = configure_lora()
    training_config = configure_training()

    # Create trainer
    print("\n🏋️  Creating SFTTrainer...")
    trainer = SFTTrainer(
        model=base_model,
        train_dataset=train_data,
        peft_config=lora_config,
        args=training_config,
        data_collator=collator,
    )

    # Train
    print("\n" + "=" * 60)
    print("🔥 Starting Training...")
    print("=" * 60)
    trainer.train()

    # Save to Hub
    print("\n📤 Uploading model to HuggingFace Hub...")
    trainer.model.push_to_hub(PROJECT_RUN_NAME, private=True)
    print(f"✓ Model saved: {PROJECT_RUN_NAME}")

    # Cleanup
    if LOG_TO_WANDB:
        wandb.finish()

    print("\n" + "=" * 60)
    print("✅ Training Complete!")
    print(f"   Model available at: https://huggingface.co/{HUB_MODEL_NAME}")
    print("=" * 60)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Fine-tune Llama 3.1 on product pricing")
    parser.add_argument("--hf_token", required=True, help="HuggingFace API token")
    parser.add_argument("--wandb_key", help="Weights & Biases API key (optional)")

    args = parser.parse_args()

    main(args.hf_token, args.wandb_key)
