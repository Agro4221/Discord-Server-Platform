            option.setName("user").setDescription("User").setRequired(true)
          )
          .addIntegerOption((option) =>
            option
              .setName("limit")
              .setDescription("Number of cases")
              .setMinValue(1)
              .setMaxValue(50)
          )
      ),

    new SlashCommandBuilder()
      .setName("ticket")
      .setDescription("Ticket system")
      .addSubcommand((sub) =>
        sub.setName("create").setDescription("Create a support ticket")
      )
      .addSubcommand((sub) =>
        sub
          .setName("setup")
          .setDescription("Configure tickets")
          .addChannelOption((option) =>
            option
              .setName("category")
              .setDescription("Ticket category")
              .addChannelTypes(ChannelType.GuildCategory)
          )
          .addRoleOption((option) =>
            option.setName("staff-role").setDescription("Staff role")
          )
          .addChannelOption((option) =>
            option
              .setName("transcript-channel")
              .setDescription("Transcript channel")
              .addChannelTypes(ChannelType.GuildText)
          )
          .addIntegerOption((option) =>
            option.setName("max-open").setDescription("Max open tickets per user").setMinValue(1).setMaxValue(10)
          )
          .addIntegerOption((option) =>
            option.setName("auto-close").setDescription("Auto-close after inactivity in minutes; 0 = off").setMinValue(0).setMaxValue(43200)
          )
      ),

    new SlashCommandBuilder()
      .setName("roles")
      .setDescription("Role panels")
      .addSubcommand((sub) =>
        sub
          .setName("panel")
          .setDescription("Create a role panel")
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("Text channel")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
          .addRoleOption((option) =>
            option.setName("role").setDescription("Role to toggle").setRequired(true)
          )
          .addStringOption((option) =>
            option
              .setName("label")
              .setDescription("Button label")
              .setMaxLength(80)
              .setRequired(true)
          )
          .addStringOption((option) =>
            option
              .setName("mode")
              .setDescription("Role selection mode")
              .addChoices(
                { name: "Toggle", value: "toggle" },
                { name: "Exclusive", value: "exclusive" },
                { name: "Max selections", value: "max" }
              )
          )
          .addIntegerOption((option) =>
            option.setName("max-selections").setDescription("Maximum selections for max mode").setMinValue(1).setMaxValue(5)
          )
      ),

    new SlashCommandBuilder()
      .setName("giveaway")
      .setDescription("Giveaways")
      .addSubcommand((sub) =>
        sub
          .setName("create")
          .setDescription("Create a giveaway")
          .addIntegerOption((option) =>
            option
              .setName("minutes")
              .setDescription("Duration")
              .setMinValue(1)
              .setMaxValue(10080)
              .setRequired(true)
          )
          .addStringOption((option) =>
            option
              .setName("prize")
              .setDescription("Prize")
              .setMaxLength(200)
              .setRequired(true)
          )
          .addIntegerOption((option) =>
            option
              .setName("winners")
              .setDescription("Winner count")
              .setMinValue(1)
              .setMaxValue(100)
          )
      )
      .addSubcommand((sub) => sub
        .setName("end")